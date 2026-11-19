import {
	LineSegments,
	Line,
	LineLoop,
	BufferGeometry,
	Raycaster,
	Float32BufferAttribute,
	Uint16BufferAttribute,
	Vector3,
} from 'three';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
	LineBVH,
	LineLoopBVH,
	LineSegmentsBVH,
} from 'three-mesh-bvh';
import { random, setSeed } from './utils.js';

Line.prototype.raycast = acceleratedRaycast;
LineLoop.prototype.raycast = acceleratedRaycast;
LineSegments.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

function makeGeometry( indexed, groups ) {

	const vertexCount = 12;
	const positions = new Float32Array( vertexCount * 3 );
	setSeed( 12345 );
	for ( let i = 0; i < vertexCount; i ++ ) {

		positions[ i * 3 + 0 ] = random() * 10 - 5;
		positions[ i * 3 + 1 ] = random() * 10 - 5;
		positions[ i * 3 + 2 ] = random() * 10 - 5;

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );

	if ( indexed ) {

		const indices = new Uint16Array( vertexCount );
		for ( let i = 0; i < vertexCount; i ++ ) indices[ i ] = ( i * 7 ) % vertexCount; // shuffled
		geometry.setIndex( new Uint16BufferAttribute( indices, 1 ) );

	}

	if ( groups ) {

		geometry.addGroup( 0, 4, 0 );
		geometry.addGroup( 4, 4, 1 );
		geometry.addGroup( 8, 4, 2 );

	}

	return geometry;

}

function makeObject( geometry, type ) {

	if ( type === LineSegmentsBVH ) return new LineSegments( geometry );
	if ( type === LineBVH ) return new Line( geometry );
	return new LineLoop( geometry );

}

function makeRays( count ) {

	const rays = [];
	setSeed( 999 );
	for ( let i = 0; i < count; i ++ ) {

		const origin = new Vector3( random() - 0.5, random() - 0.5, random() - 0.5 ).normalize().multiplyScalar( 10 );
		const direction = origin.clone().multiplyScalar( - 1 ).normalize();
		rays.push( { origin, direction } );

	}

	return rays;

}

function castRays( object, raycaster, rays ) {

	const map = h => ( { index: h.index, distance: h.distance, point: h.point } );
	const results = { all: [], first: [] };
	for ( const { origin, direction } of rays ) {

		raycaster.ray.origin.copy( origin );
		raycaster.ray.direction.copy( direction );

		raycaster.firstHitOnly = false;
		const all = raycaster.intersectObject( object ).map( map );
		results.all.push( all );

		// "firstHitOnly" is a bvh-only flag so the native result falls back to
		// the closest of all hits, which intersectObject sorts by distance
		raycaster.firstHitOnly = true;
		const first = raycaster.intersectObject( object ).map( map );
		results.first.push( first[ 0 ] || null );

	}

	return results;

}

const types = { LineSegmentsBVH, LineLoopBVH, LineBVH };

describe( 'Line BVH draw range / groups consistency', () => {

	for ( const [ typeName, type ] of Object.entries( types ) ) {

		for ( const indexed of [ true, false ] ) {

			for ( const groups of [ true, false ] ) {

				for ( const drawRange of [ null, { start: 2, count: 6 }, { start: 3, count: 9 }, { start: 1, count: 5 }, { start: 4, count: 3 } ] ) {

					it( `${ typeName } indexed=${ indexed } groups=${ groups } drawRange=${ JSON.stringify( drawRange ) }`, () => {

						const geometry = makeGeometry( indexed, groups );
						if ( drawRange ) geometry.setDrawRange( drawRange.start, drawRange.count );

						const object = makeObject( geometry, type );
						const raycaster = new Raycaster();
						raycaster.params.Line.threshold = 0.5;
						const rays = makeRays( 50 );

						// build the bvh first - a non-indirect build reorders the
						// index buffer and the native raycast must run on the same
						// final geometry state
						geometry.computeBoundsTree( { type } );
						const bvhTree = geometry.boundsTree;
						const bvh = castRays( object, raycaster, rays );

						// native results
						geometry.boundsTree = null;
						const native = castRays( object, raycaster, rays );

						expect( bvh.all ).toEqual( native.all );
						expect( bvh.first ).toEqual( native.first );

						// after refit
						geometry.boundsTree = bvhTree;
						geometry.boundsTree.refit();
						const refit = castRays( object, raycaster, rays );

						expect( refit.all ).toEqual( native.all );
						expect( refit.first ).toEqual( native.first );

					} );

				}

			}

		}

	}

} );
