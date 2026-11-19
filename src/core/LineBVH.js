/** @import { BufferGeometry } from 'three' */
/** @import { IntersectsBoundsCallback, IntersectsRangeCallback, BoundsTraverseOrderCallback } from './BVH.js' */
import { Matrix4, Line3, Vector3, Ray, Box3, REVISION } from 'three';
import { PrimitivePool } from '../utils/PrimitivePool.js';
import { INTERSECTED, NOT_INTERSECTED } from './Constants.js';
import { GeometryBVH } from './GeometryBVH.js';
import { getVertexCount } from './build/geometryUtils.js';

// three.js r188 scales the raycast threshold by the largest world scale (mrdoob/three.js#35466)
const IS_GT_REVISION_188 = parseInt( REVISION ) >= 188;

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _ray = /* @__PURE__ */ new Ray();
const _linePool = /* @__PURE__ */ new PrimitivePool( () => new Line3() );
const _intersectPointOnRay = /*@__PURE__*/ new Vector3();
const _intersectPointOnSegment = /*@__PURE__*/ new Vector3();
const _box = /* @__PURE__ */ new Box3();
const _vec = /* @__PURE__ */ new Vector3();
const _getters = [ 'getX', 'getY', 'getZ' ];

/**
 * @callback IntersectsLineCallback
 * @param {Line3} line - The line segment primitive in local space.
 * @param {number} index - The primitive index within the BVH buffer.
 * @param {boolean} contained - Whether the node bounds are fully contained by the query shape.
 * @param {number} depth - The depth of the node in the tree.
 * @returns {boolean} Return `true` to stop traversal.
 */

/**
 * BVH for `THREE.LineSegments` geometries. Each BVH primitive represents one line segment
 * (two consecutive vertices).
 * @extends GeometryBVH
 */
export class LineSegmentsBVH extends GeometryBVH {

	get primitiveStride() {

		return 2;

	}

	constructor( geometry, options = {} ) {

		// Native raycasting pairs vertices starting at the draw range start, so an
		// odd start shifts the segments off the index buffer's natural vertex
		// pairs. The non-indirect build can only reorder whole vertex pairs in
		// the index buffer so fall back to indirect mode to keep the segment
		// topology consistent with native raycasting.
		const drawRange = options.range || geometry.drawRange;
		if ( ! options.indirect && Math.max( 0, drawRange.start ) % 2 !== 0 ) {

			options = {
				...options,
				indirect: true,
			};

		}

		super( geometry, options );

	}

	init( options ) {

		// store the segment lattice shift so primitives map to the same vertices
		// that native raycasting uses
		const drawRange = options.range || this.geometry.drawRange;
		this._vertexOffset = this.getVertexOffset( drawRange );

		super.init( options );

	}

	/**
	 * Returns the shift of the segment lattice relative to the natural vertex
	 * pairs in the index buffer imposed by the draw range. "LineSegments"
	 * primitives pair vertices starting at the draw range start, so an odd
	 * start shifts the lattice by one.
	 * @param {Object} drawRange
	 * @returns {number}
	 */
	getVertexOffset( drawRange ) {

		return Math.max( 0, drawRange.start ) % 2;

	}

	getIndirectRanges( range ) {

		const vertexOffset = this._vertexOffset || 0;
		if ( vertexOffset === 0 ) {

			return super.getIndirectRanges( range );

		}

		// With a shifted segment lattice the primitives no longer align with the
		// group boundaries, and native raycasting ignores groups anyway, so
		// generate the segments from the draw range alone.
		const { geometry, primitiveStride } = this;
		const drawRange = range || geometry.drawRange;
		const vertCount = getVertexCount( geometry );
		const start = Math.max( 0, drawRange.start );
		const end = Math.min( vertCount, drawRange.start + drawRange.count );

		return [ {
			offset: ( start - vertexOffset ) / primitiveStride,
			count: Math.floor( ( end - start ) / primitiveStride ),
		} ];

	}

	/**
	 * Returns the index of the vertex that follows `i0` in the line topology,
	 * before the index buffer is resolved. Open topologies simply connect each
	 * vertex to the next one in the buffer. Closed topologies (see
	 * {@link LineLoopBVH}) wrap the last vertex in the draw range back to the
	 * start of the range.
	 * @param {number} i0 - The vertex position of the segment start.
	 * @returns {number} The vertex position of the segment end.
	 */
	getNextVertexIndex( i0 ) {

		return i0 + 1;

	}

	writePrimitiveBounds( i, targetBuffer, baseIndex ) {

		const indirectBuffer = this._indirectBuffer;
		const { geometry, primitiveStride } = this;

		const posAttr = geometry.attributes.position;
		const indexAttr = geometry.index;

		const prim = indirectBuffer ? indirectBuffer[ i ] : i;
		let i0 = prim * primitiveStride + this._vertexOffset;
		let i1 = this.getNextVertexIndex( i0 );
		if ( indexAttr ) {

			i0 = indexAttr.getX( i0 );
			i1 = indexAttr.getX( i1 );

		}

		for ( let el = 0; el < 3; el ++ ) {

			const v0 = posAttr[ _getters[ el ] ]( i0 );
			const v1 = posAttr[ _getters[ el ] ]( i1 );
			const min = v0 < v1 ? v0 : v1;
			const max = v0 > v1 ? v0 : v1;

			// Write in min/max format [minx, miny, minz, maxx, maxy, maxz]
			targetBuffer[ baseIndex + el ] = min;
			targetBuffer[ baseIndex + el + 3 ] = max;

		}

		return targetBuffer;

	}

	/**
	 * Performs a spatial query against the BVH. Extends the base `shapecast` with an
	 * `intersectsLine` callback that is called once per line segment primitive in leaf nodes.
	 *
	 * @param {Object} callbacks
	 * @param {IntersectsBoundsCallback} callbacks.intersectsBounds
	 * @param {IntersectsLineCallback} [callbacks.intersectsLine]
	 * @param {IntersectsRangeCallback} [callbacks.intersectsRange]
	 * @param {BoundsTraverseOrderCallback} [callbacks.boundsTraverseOrder]
	 * @returns {boolean}
	 */
	shapecast( callbacks ) {

		const line = _linePool.getPrimitive();
		const result = super.shapecast( {
			...callbacks,
			intersectsPrimitive: callbacks.intersectsLine,
			scratchPrimitive: line,
			iterate: iterateOverLines,
		} );
		_linePool.releasePrimitive( line );

		return result;

	}

	raycastObject3D( object, raycaster, intersects = [] ) {

		const { matrixWorld } = object;
		const { firstHitOnly } = raycaster;

		_inverseMatrix.copy( matrixWorld ).invert();
		_ray.copy( raycaster.ray ).applyMatrix4( _inverseMatrix );

		const threshold = raycaster.params.Line.threshold;
		const scale = IS_GT_REVISION_188 ?
			matrixWorld.getMaxScaleOnAxis() :
			( object.scale.x + object.scale.y + object.scale.z ) / 3;
		const localThreshold = threshold / scale;
		const localThresholdSq = localThreshold * localThreshold;

		let closestHit = null;
		let closestDistance = Infinity;
		this.shapecast( {
			boundsTraverseOrder: box => {

				return box.distanceToPoint( _ray.origin );

			},
			intersectsBounds: box => {

				_box.copy( box ).expandByScalar( localThreshold );

				if ( firstHitOnly ) {

					if ( ! _ray.intersectBox( _box, _vec ) ) {

						return NOT_INTERSECTED;

					}

					let dist;
					if ( _box.containsPoint( _ray.origin ) ) {

						dist = 0;

					} else {

						_vec.applyMatrix4( matrixWorld );
						dist = raycaster.ray.origin.distanceTo( _vec );

					}

					// early out if the box is further than the closest raycast
					return dist < closestDistance ? INTERSECTED : NOT_INTERSECTED;

				} else {

					return _ray.intersectsBox( _box ) ? INTERSECTED : NOT_INTERSECTED;

				}

			},
			intersectsLine: ( line, index ) => {

				const distSq = _ray.distanceSqToSegment( line.start, line.end, _intersectPointOnRay, _intersectPointOnSegment );

				if ( distSq > localThresholdSq ) return;

				_intersectPointOnRay.applyMatrix4( object.matrixWorld );

				const distance = raycaster.ray.origin.distanceTo( _intersectPointOnRay );

				if ( distance < raycaster.near || distance > raycaster.far ) return;

				if ( firstHitOnly && distance >= closestDistance ) return;
				closestDistance = distance;

				index = this.resolvePrimitiveIndex( index );

				closestHit = {
					distance,
					point: _intersectPointOnSegment.clone().applyMatrix4( matrixWorld ),
					index: index * this.primitiveStride + this._vertexOffset,
					face: null,
					faceIndex: null,
					barycoord: null,
					object,
				};

				if ( ! firstHitOnly ) {

					intersects.push( closestHit );

				}

			},
		} );

		if ( firstHitOnly && closestHit ) {

			intersects.push( closestHit );

		}

		return intersects;

	}

}

/**
 * BVH for `THREE.LineLoop` geometries. Forces indirect mode since the loop structure
 * requires that the index buffer remain unmodified.
 * @param {BufferGeometry} geometry
 * @param {Object} [options] - Same options as {@link GeometryBVH}. `indirect` is always forced to `true`.
 * @extends LineSegmentsBVH
 */
export class LineLoopBVH extends LineSegmentsBVH {

	get primitiveStride() {

		return 1;

	}

	constructor( geometry, options = {} ) {

		// "Line" and "LineLoop" BVH must be indirect since we cannot rearrange the index
		// buffer without breaking the lines
		options = {
			...options,
			indirect: true,
		};

		super( geometry, options );

	}

	// The loop topology is defined in vertex units so no segment lattice shift
	// applies.
	getVertexOffset() {

		return 0;

	}

	// Native line raycasting ignores material groups and only respects the draw
	// range, so the indirect buffer spans the whole draw range rather than the
	// group-aligned ranges.
	getIndirectRanges( range ) {

		const { geometry } = this;
		const drawRange = range || geometry.drawRange;
		const vertCount = getVertexCount( geometry );
		const start = Math.max( 0, drawRange.start );
		const end = Math.min( vertCount, drawRange.start + drawRange.count );

		// Store the vertex range so the closing segment of the loop can connect
		// the last vertex in the range back to the first one.
		this._drawRangeStart = start;
		this._drawRangeEnd = end;

		return [ { offset: start, count: end - start } ];

	}

	// The last vertex in the draw range connects back to the first vertex in
	// the range to close the loop, matching native "LineLoop" raycasting.
	getNextVertexIndex( i0 ) {

		const next = i0 + 1;
		return next >= this._drawRangeEnd ? this._drawRangeStart : next;

	}

}

/**
 * BVH for `THREE.Line` geometries. Like `LineLoopBVH` but excludes the final closing
 * segment so the open line is accurately represented.
 * @param {BufferGeometry} geometry
 * @param {Object} [options] - Same options as {@link GeometryBVH}. `indirect` is always forced to `true`.
 * @extends LineLoopBVH
 */
export class LineBVH extends LineLoopBVH {

	// The open line connects each vertex to the next one without ever wrapping
	// back to the start of the draw range.
	getNextVertexIndex( i0 ) {

		return i0 + 1;

	}

	getRootRanges( ...args ) {

		const res = super.getRootRanges( ...args );
		res.forEach( group => group.count = Math.max( 0, group.count - 1 ) );
		return res;

	}

}

function iterateOverLines(
	offset,
	count,
	bvh,
	intersectsPointFunc,
	contained,
	depth,
	line
) {

	const { geometry, primitiveStride } = bvh;
	const { index } = geometry;
	const posAttr = geometry.attributes.position;

	for ( let i = offset, l = count + offset; i < l; i ++ ) {

		const prim = bvh.resolvePrimitiveIndex( i );
		let i0 = prim * primitiveStride + bvh._vertexOffset;
		let i1 = bvh.getNextVertexIndex( i0 );
		if ( index ) {

			i0 = index.getX( i0 );
			i1 = index.getX( i1 );

		}

		line.start.fromBufferAttribute( posAttr, i0 );
		line.end.fromBufferAttribute( posAttr, i1 );

		if ( intersectsPointFunc( line, i, contained, depth ) ) {

			return true;

		}

	}

	return false;

}
