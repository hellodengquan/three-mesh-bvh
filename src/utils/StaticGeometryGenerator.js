/** @import { Mesh, Material, Object3D } from 'three' */
import { BufferAttribute, BufferGeometry, Vector3, Vector4, Matrix4, Matrix3 } from 'three';

const _positionVector = /*@__PURE__*/ new Vector3();
const _normalVector = /*@__PURE__*/ new Vector3();
const _tangentVector = /*@__PURE__*/ new Vector3();
const _tangentVector4 = /*@__PURE__*/ new Vector4();

const _morphVector = /*@__PURE__*/ new Vector3();
const _temp = /*@__PURE__*/ new Vector3();

const _skinIndex = /*@__PURE__*/ new Vector4();
const _skinWeight = /*@__PURE__*/ new Vector4();
const _matrix = /*@__PURE__*/ new Matrix4();
const _boneMatrix = /*@__PURE__*/ new Matrix4();

// Confirms that the two provided attributes are compatible
function validateAttributes( attr1, attr2 ) {

	if ( ! attr1 && ! attr2 ) {

		return;

	}

	const sameCount = attr1.count === attr2.count;
	const sameNormalized = attr1.normalized === attr2.normalized;
	const sameType = attr1.array.constructor === attr2.array.constructor;
	const sameItemSize = attr1.itemSize === attr2.itemSize;

	if ( ! sameCount || ! sameNormalized || ! sameType || ! sameItemSize ) {

		throw new Error();

	}

}

// Clones the given attribute with a new compatible buffer attribute but no data
function createAttributeClone( attr, countOverride = null ) {

	const cons = attr.array.constructor;
	const normalized = attr.normalized;
	const itemSize = attr.itemSize;
	const count = countOverride === null ? attr.count : countOverride;

	return new BufferAttribute( new cons( itemSize * count ), itemSize, normalized );

}

// target offset is the number of elements in the target buffer stride to skip before copying the
// attributes contents in to.
function copyAttributeContents( attr, target, targetOffset = 0 ) {

	if ( attr.isInterleavedBufferAttribute ) {

		const itemSize = attr.itemSize;
		for ( let i = 0, l = attr.count; i < l; i ++ ) {

			const io = i + targetOffset;
			target.setX( io, attr.getX( i ) );
			if ( itemSize >= 2 ) target.setY( io, attr.getY( i ) );
			if ( itemSize >= 3 ) target.setZ( io, attr.getZ( i ) );
			if ( itemSize >= 4 ) target.setW( io, attr.getW( i ) );

		}

	} else {

		const array = target.array;
		const cons = array.constructor;
		const byteOffset = array.BYTES_PER_ELEMENT * attr.itemSize * targetOffset;
		const temp = new cons( array.buffer, byteOffset, attr.array.length );
		temp.set( attr.array );

	}

}

// Adds the "matrix" multiplied by "scale" to "target"
function addScaledMatrix( target, matrix, scale ) {

	const targetArray = target.elements;
	const matrixArray = matrix.elements;
	for ( let i = 0, l = matrixArray.length; i < l; i ++ ) {

		targetArray[ i ] += matrixArray[ i ] * scale;

	}

}

// A version of "SkinnedMesh.boneTransform" for normals
function boneNormalTransform( mesh, index, target ) {

	const skeleton = mesh.skeleton;
	const geometry = mesh.geometry;
	const bones = skeleton.bones;
	const boneInverses = skeleton.boneInverses;

	_skinIndex.fromBufferAttribute( geometry.attributes.skinIndex, index );
	_skinWeight.fromBufferAttribute( geometry.attributes.skinWeight, index );

	_matrix.elements.fill( 0 );

	for ( let i = 0; i < 4; i ++ ) {

		const weight = _skinWeight.getComponent( i );

		if ( weight !== 0 ) {

			const boneIndex = _skinIndex.getComponent( i );
			_boneMatrix.multiplyMatrices( bones[ boneIndex ].matrixWorld, boneInverses[ boneIndex ] );

			addScaledMatrix( _matrix, _boneMatrix, weight );

		}

	}

	_matrix.multiply( mesh.bindMatrix ).premultiply( mesh.bindMatrixInverse );
	target.transformDirection( _matrix );

	return target;

}

// Applies the morph target data to the target vector
function applyMorphTarget( morphData, morphInfluences, morphTargetsRelative, i, target ) {

	_morphVector.set( 0, 0, 0 );
	for ( let j = 0, jl = morphData.length; j < jl; j ++ ) {

		const influence = morphInfluences[ j ];
		const morphAttribute = morphData[ j ];

		if ( influence === 0 ) continue;

		_temp.fromBufferAttribute( morphAttribute, i );

		if ( morphTargetsRelative ) {

			_morphVector.addScaledVector( _temp, influence );

		} else {

			_morphVector.addScaledVector( _temp.sub( target ), influence );

		}

	}

	target.add( _morphVector );

}

// Modified version of BufferGeometryUtils.mergeBufferGeometries that ignores morph targets and updates a attributes in place
function mergeBufferGeometries( geometries, options = { useGroups: false, updateIndex: false, skipAttributes: [] }, targetGeometry = new BufferGeometry() ) {

	const isIndexed = geometries[ 0 ].index !== null;
	const { useGroups = false, updateIndex = false, skipAttributes = [] } = options;

	const attributesUsed = new Set( Object.keys( geometries[ 0 ].attributes ) );
	const attributes = {};

	let offset = 0;

	targetGeometry.clearGroups();
	for ( let i = 0; i < geometries.length; ++ i ) {

		const geometry = geometries[ i ];
		let attributesCount = 0;

		// ensure that all geometries are indexed, or none
		if ( isIndexed !== ( geometry.index !== null ) ) {

			throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.' );

		}

		// gather attributes, exit early if they're different
		for ( const name in geometry.attributes ) {

			if ( ! attributesUsed.has( name ) ) {

				throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure "' + name + '" attribute exists among all geometries, or in none of them.' );

			}

			if ( attributes[ name ] === undefined ) {

				attributes[ name ] = [];

			}

			attributes[ name ].push( geometry.attributes[ name ] );
			attributesCount ++;

		}

		// ensure geometries have the same number of attributes
		if ( attributesCount !== attributesUsed.size ) {

			throw new Error( 'StaticGeometryGenerator: Make sure all geometries have the same number of attributes.' );

		}

		if ( useGroups ) {

			let count;
			if ( isIndexed ) {

				count = geometry.index.count;

			} else if ( geometry.attributes.position !== undefined ) {

				count = geometry.attributes.position.count;

			} else {

				throw new Error( 'StaticGeometryGenerator: The geometry must have either an index or a position attribute' );

			}

			targetGeometry.addGroup( offset, count, i );
			offset += count;

		}

	}

	// merge indices
	if ( isIndexed ) {

		let forceUpdateIndex = false;
		if ( ! targetGeometry.index ) {

			let indexCount = 0;
			for ( let i = 0; i < geometries.length; ++ i ) {

				indexCount += geometries[ i ].index.count;

			}

			targetGeometry.setIndex( new BufferAttribute( new Uint32Array( indexCount ), 1, false ) );
			forceUpdateIndex = true;

		}

		if ( updateIndex || forceUpdateIndex ) {

			const targetIndex = targetGeometry.index;
			let targetOffset = 0;
			let indexOffset = 0;
			for ( let i = 0; i < geometries.length; ++ i ) {

				const geometry = geometries[ i ];
				const index = geometry.index;
				if ( skipAttributes[ i ] !== true ) {

					for ( let j = 0; j < index.count; ++ j ) {

						targetIndex.setX( targetOffset + j, index.getX( j ) + indexOffset );

					}

				}

				// advance the offsets for every geometry, including skipped ones, so the data
				// for subsequent geometries is written at the correct location
				targetOffset += index.count;
				indexOffset += geometry.attributes.position.count;

			}

		}

	}

	// merge attributes
	for ( const name in attributes ) {

		const attrList = attributes[ name ];
		if ( ! ( name in targetGeometry.attributes ) ) {

			let count = 0;
			for ( const key in attrList ) {

				count += attrList[ key ].count;

			}

			targetGeometry.setAttribute( name, createAttributeClone( attributes[ name ][ 0 ], count ) );

		}

		const targetAttribute = targetGeometry.attributes[ name ];
		let offset = 0;
		for ( let i = 0, l = attrList.length; i < l; i ++ ) {

			const attr = attrList[ i ];
			if ( skipAttributes[ i ] !== true ) {

				copyAttributeContents( attr, targetAttribute, offset );

			}

			offset += attr.count;

		}

	}

	return targetGeometry;

}

// Compares two arrays or typed arrays, treating null and null as equal
function checkArrayEquality( a, b ) {

	if ( a === null || b === null ) {

		return a === b;

	}

	if ( a.length !== b.length ) {

		return false;

	}

	for ( let i = 0, l = a.length; i < l; i ++ ) {

		if ( a[ i ] !== b[ i ] ) {

			return false;

		}

	}

	return true;

}

function invertGeometry( geometry ) {

	const { index, attributes } = geometry;
	if ( index ) {

		for ( let i = 0, l = index.count; i < l; i += 3 ) {

			const v0 = index.getX( i );
			const v2 = index.getX( i + 2 );
			index.setX( i, v2 );
			index.setX( i + 2, v0 );

		}

	} else {

		for ( const key in attributes ) {

			const attr = attributes[ key ];
			const itemSize = attr.itemSize;
			for ( let i = 0, l = attr.count; i < l; i += 3 ) {

				for ( let j = 0; j < itemSize; j ++ ) {

					const v0 = attr.getComponent( i, j );
					const v2 = attr.getComponent( i + 2, j );
					attr.setComponent( i, j, v2 );
					attr.setComponent( i + 2, j, v0 );

				}

			}

		}

	}

	return geometry;


}

// Returns the number of primitives to bake for the geometry
function getPrimitiveCount( geometry ) {

	return ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3;

}

// Returns the version of the attribute data, accounting for interleaved attributes
function getAttributeVersion( attr ) {

	return attr.isInterleavedBufferAttribute ? attr.data.version : attr.version;

}

// Fills "target" with the attributes and versions baked from the geometry. Morph target
// attributes are included since they are baked into the output as well. The attribute references
// are stored alongside the versions so attribute replacement is detected even if the new
// attribute happens to have the same version number.
function getAttributeState( geometry, target ) {

	target.length = 0;

	const addAttribute = attr => {

		if ( attr ) {

			target.push( attr, getAttributeVersion( attr ) );

		}

	};

	addAttribute( geometry.index );

	const attributes = geometry.attributes;
	for ( const key in attributes ) {

		addAttribute( attributes[ key ] );

	}

	const morphAttributes = geometry.morphAttributes;
	for ( const key in morphAttributes ) {

		const attrList = morphAttributes[ key ];
		for ( let i = 0, l = attrList.length; i < l; i ++ ) {

			addAttribute( attrList[ i ] );

		}

	}

	return target;

}

// Ensures the skeleton's flattened bone matrices reflect the current bone transforms
function updateSkeleton( skeleton ) {

	// ensure the bone matrix array is updated to the appropriate length
	if ( ! skeleton.boneTexture ) {

		skeleton.computeBoneTexture();

	}

	skeleton.update();

}

// scratch array reused when comparing the baked attribute state to avoid per-frame allocations
const _attributeStateScratch = [];

// Checks whether the geometry changed between this and last evaluation
class GeometryDiff {

	constructor( mesh ) {

		this.matrixWorld = new Matrix4();
		this.geometry = null;
		this.attributeState = null;
		this.morphTargetsRelative = false;
		this.morphTargetInfluences = null;
		this.skeleton = null;
		this.boneMatrices = null;
		this.primitiveCount = - 1;
		this.vertexCount = - 1;
		this.mesh = mesh;

		this.update();

	}

	update() {

		const mesh = this.mesh;
		const geometry = mesh.geometry;
		const skeleton = mesh.skeleton;
		const morphTargetInfluences = mesh.morphTargetInfluences;
		const primitiveCount = getPrimitiveCount( geometry );
		this.matrixWorld.copy( mesh.matrixWorld );
		this.geometry = geometry;
		this.attributeState = getAttributeState( geometry, [] );
		this.morphTargetsRelative = geometry.morphTargetsRelative;
		this.primitiveCount = primitiveCount;
		this.vertexCount = geometry.attributes.position.count;

		// store a copy of the morph target weights so changes to them are detected even if the
		// skeleton and world matrix remain the same
		this.morphTargetInfluences = morphTargetInfluences ? morphTargetInfluences.slice() : null;

		if ( skeleton ) {

			updateSkeleton( skeleton );

			// copy data if possible otherwise clone it
			const boneMatrices = skeleton.boneMatrices;
			if ( ! this.boneMatrices || this.boneMatrices.length !== boneMatrices.length ) {

				this.boneMatrices = boneMatrices.slice();

			} else {

				this.boneMatrices.set( boneMatrices );

			}

		} else {

			this.boneMatrices = null;

		}

		this.skeleton = skeleton;

	}

	// returns whether the attribute references and versions of the geometry match the stored ones
	hasSameAttributes( geometry ) {

		const state = getAttributeState( geometry, _attributeStateScratch );
		const previous = this.attributeState;
		if ( ! previous || previous.length !== state.length ) {

			return false;

		}

		for ( let i = 0, l = state.length; i < l; i ++ ) {

			if ( state[ i ] !== previous[ i ] ) {

				return false;

			}

		}

		return true;

	}

	didChange() {

		const mesh = this.mesh;
		const geometry = mesh.geometry;
		const skeleton = mesh.skeleton;

		// the bone matrices are only updated when the skeleton is rendered so ensure they reflect
		// the current pose before comparing them
		if ( skeleton ) {

			updateSkeleton( skeleton );

		}

		const identical =
			this.geometry === geometry &&
			this.matrixWorld.equals( mesh.matrixWorld ) &&
			this.hasSameAttributes( geometry ) &&
			geometry.morphTargetsRelative === this.morphTargetsRelative &&
			checkArrayEquality( mesh.morphTargetInfluences || null, this.morphTargetInfluences ) &&
			this.skeleton === skeleton &&
			checkArrayEquality( skeleton && skeleton.boneMatrices || null, this.boneMatrices ) &&
			getPrimitiveCount( geometry ) === this.primitiveCount &&
			geometry.attributes.position.count === this.vertexCount;

		return ! identical;

	}

}

/**
 * A utility class for taking a set of SkinnedMeshes or morph target geometry and baking it into
 * a single, static geometry that a BVH can be generated for.
 */
export class StaticGeometryGenerator {

	/**
	 * Takes an array of object hierarchies to bake into a single static geometry.
	 *
	 * @param {Object3D|Array<Object3D>} meshes
	 */
	constructor( meshes ) {

		if ( ! Array.isArray( meshes ) ) {

			meshes = [ meshes ];

		}

		const finalMeshes = [];
		meshes.forEach( object => {

			object.traverseVisible( c => {

				if ( c.isMesh ) {

					finalMeshes.push( c );

				}

			} );

		} );

		/**
		 * @type {Array<Mesh>}
		 */
		this.meshes = finalMeshes;

		/**
		 * If true then groups are used to support an array of materials on the mesh.
		 * @type {boolean}
		 */
		this.useGroups = true;

		/**
		 * Whether to transform the vertices of the geometry by the world transforms of each mesh when generating.
		 * @type {boolean}
		 */
		this.applyWorldTransforms = true;

		/**
		 * The set of attributes to copy onto the static geometry.
		 * @type {Array<string>}
		 */
		this.attributes = [ 'position', 'normal', 'color', 'tangent', 'uv', 'uv2' ];
		this._intermediateGeometry = new Array( finalMeshes.length ).fill().map( () => new BufferGeometry() );
		this._diffMap = new WeakMap();

		// the "applyWorldTransforms" value and per-mesh index winding state that the generated
		// geometry currently reflects so changes to either can be detected
		this._lastApplyWorldTransforms = null;
		this._indexState = null;

	}

	/**
	 * Returns an array of materials for the meshes to be merged. These can be used alongside the
	 * generated geometry when creating a mesh: `new Mesh( geometry, generator.getMaterials() )`.
	 *
	 * @returns {Array<Material>}
	 */
	getMaterials() {

		const materials = [];
		this.meshes.forEach( mesh => {

			if ( Array.isArray( mesh.material ) ) {

				materials.push( ...mesh.material );

			} else {

				materials.push( mesh.material );

			}

		} );
		return materials;

	}

	/**
	 * Generates a single, static geometry for the passed meshes. When generating for the first
	 * time an empty target geometry is expected. The same generated geometry can be passed into
	 * the function on subsequent calls to update the geometry in place to save memory. An error
	 * will be thrown if the attributes or geometry on the meshes to bake has been changed and
	 * are incompatible lengths, types, etc.
	 *
	 * On subsequent calls the "index" buffer will not be modified unless the geometry's index or
	 * a mesh's mirrored state changed, so any BVH generated for the geometry is unaffected. Once
	 * the geometry is updated the `MeshBVH.refit` function can be called to update the BVH.
	 *
	 * @param {BufferGeometry} [targetGeometry]
	 * @returns {BufferGeometry}
	 */
	generate( targetGeometry = new BufferGeometry() ) {

		const { meshes, useGroups, applyWorldTransforms, _intermediateGeometry, _diffMap } = this;

		// if the "applyWorldTransforms" setting has changed then every mesh needs to be re-baked
		// and the merged index buffer rewritten since the baked winding order may have changed
		const transformStateChanged = this._lastApplyWorldTransforms !== null && this._lastApplyWorldTransforms !== applyWorldTransforms;
		if ( transformStateChanged ) {

			for ( let i = 0, l = meshes.length; i < l; i ++ ) {

				_diffMap.delete( meshes[ i ] );

			}

		}

		// only skip meshes if the target geometry already contains the previously baked data -
		// otherwise there is nothing to skip and every mesh has to be copied over. The per-mesh
		// vertex counts also have to match so the merged attribute and index offsets are unchanged.
		const prevIndexState = this._indexState;
		let vertexCount = 0;
		let sameVertexCounts = !! prevIndexState && prevIndexState.length === meshes.length;
		for ( let i = 0, l = meshes.length; i < l; i ++ ) {

			const count = meshes[ i ].geometry.attributes.position.count;
			vertexCount += count;

			if ( ! prevIndexState || ! prevIndexState[ i ] || prevIndexState[ i ].vertexCount !== count ) {

				sameVertexCounts = false;

			}

		}

		const targetPosition = targetGeometry.attributes.position;
		const isReusableTarget = sameVertexCounts && !! targetPosition && targetPosition.count === vertexCount;

		// track which attributes have been updated and which to skip to avoid unnecessary attribute copies
		let skipAttributes = [];
		const indexState = new Array( meshes.length );
		let updateIndex = transformStateChanged || ! isReusableTarget;
		for ( let i = 0, l = meshes.length; i < l; i ++ ) {

			const mesh = meshes[ i ];
			const geometry = mesh.geometry;
			const index = geometry.index;
			const inverted = applyWorldTransforms && mesh.matrixWorld.determinant() < 0;
			indexState[ i ] = {
				index,
				version: index ? getAttributeVersion( index ) : - 1,
				count: index ? index.count : - 1,
				vertexCount: geometry.attributes.position.count,
				inverted,
			};

			// the merged index only needs to be rewritten if a mesh's index or winding order changed
			const previousState = this._indexState && this._indexState[ i ];
			if (
				! previousState ||
				previousState.index !== indexState[ i ].index ||
				previousState.version !== indexState[ i ].version ||
				previousState.count !== indexState[ i ].count ||
				previousState.vertexCount !== indexState[ i ].vertexCount ||
				previousState.inverted !== inverted
			) {

				updateIndex = true;

			}

			const geom = _intermediateGeometry[ i ];
			const diff = _diffMap.get( mesh );
			if ( ! isReusableTarget || ! diff || diff.didChange() ) {

				this._convertToStaticGeometry( mesh, geom );
				skipAttributes.push( false );

				if ( ! diff ) {

					_diffMap.set( mesh, new GeometryDiff( mesh ) );

				} else {

					diff.update();

				}

			} else {

				skipAttributes.push( true );

			}

		}

		if ( _intermediateGeometry.length === 0 ) {

			// if there are no geometries then just create a fake empty geometry to provide
			targetGeometry.setIndex( null );

			// remove all geometry
			const attrs = targetGeometry.attributes;
			for ( const key in attrs ) {

				targetGeometry.deleteAttribute( key );

			}

			// create dummy attributes
			for ( const key in this.attributes ) {

				targetGeometry.setAttribute( this.attributes[ key ], new BufferAttribute( new Float32Array( 0 ), 4, false ) );

			}

		} else {

			mergeBufferGeometries( _intermediateGeometry, { useGroups, updateIndex, skipAttributes }, targetGeometry );

		}

		this._lastApplyWorldTransforms = applyWorldTransforms;
		this._indexState = indexState;

		for ( const key in targetGeometry.attributes ) {

			targetGeometry.attributes[ key ].needsUpdate = true;

		}

		return targetGeometry;

	}

	_convertToStaticGeometry( mesh, targetGeometry = new BufferGeometry() ) {

		const geometry = mesh.geometry;
		const applyWorldTransforms = this.applyWorldTransforms;
		const includeNormal = this.attributes.includes( 'normal' );
		const includeTangent = this.attributes.includes( 'tangent' );
		const attributes = geometry.attributes;
		const targetAttributes = targetGeometry.attributes;

		// initialize the attributes if they don't exist
		if ( ! targetGeometry.index && geometry.index ) {

			targetGeometry.index = geometry.index.clone();

		}

		if ( ! targetAttributes.position ) {

			targetGeometry.setAttribute( 'position', createAttributeClone( attributes.position ) );

		}

		if ( includeNormal && ! targetAttributes.normal && attributes.normal ) {

			targetGeometry.setAttribute( 'normal', createAttributeClone( attributes.normal ) );

		}

		if ( includeTangent && ! targetAttributes.tangent && attributes.tangent ) {

			targetGeometry.setAttribute( 'tangent', createAttributeClone( attributes.tangent ) );

		}

		// ensure the attributes are consistent
		validateAttributes( geometry.index, targetGeometry.index );
		validateAttributes( attributes.position, targetAttributes.position );

		if ( includeNormal ) {

			validateAttributes( attributes.normal, targetAttributes.normal );

		}

		if ( includeTangent ) {

			validateAttributes( attributes.tangent, targetAttributes.tangent );

		}

		// generate transformed vertex attribute data
		const position = attributes.position;
		const normal = includeNormal ? attributes.normal : null;
		const tangent = includeTangent ? attributes.tangent : null;
		const morphPosition = geometry.morphAttributes.position;
		const morphNormal = geometry.morphAttributes.normal;
		const morphTangent = geometry.morphAttributes.tangent;
		const morphTargetsRelative = geometry.morphTargetsRelative;
		const morphInfluences = mesh.morphTargetInfluences;
		const normalMatrix = new Matrix3();
		normalMatrix.getNormalMatrix( mesh.matrixWorld );

		// a negative determinant world transform mirrors the geometry so the winding order and
		// the tangent frame handedness need to be adjusted to match the rendered appearance
		const mirrored = mesh.matrixWorld.determinant() < 0;
		const tangentMirrored = applyWorldTransforms && mirrored;

		// copy the index
		if ( geometry.index ) {

			targetGeometry.index.array.set( geometry.index.array );

		}

		// copy and apply other attributes
		for ( let i = 0, l = attributes.position.count; i < l; i ++ ) {

			_positionVector.fromBufferAttribute( position, i );
			if ( normal ) {

				_normalVector.fromBufferAttribute( normal, i );

			}

			if ( tangent ) {

				_tangentVector4.fromBufferAttribute( tangent, i );
				_tangentVector.fromBufferAttribute( tangent, i );

			}

			// apply morph target transform
			if ( morphInfluences ) {

				if ( morphPosition ) {

					applyMorphTarget( morphPosition, morphInfluences, morphTargetsRelative, i, _positionVector );

				}

				if ( morphNormal ) {

					applyMorphTarget( morphNormal, morphInfluences, morphTargetsRelative, i, _normalVector );

				}

				if ( morphTangent ) {

					applyMorphTarget( morphTangent, morphInfluences, morphTargetsRelative, i, _tangentVector );

				}

			}

			// apply bone transform
			if ( mesh.isSkinnedMesh ) {

				mesh.applyBoneTransform( i, _positionVector );
				if ( normal ) {

					boneNormalTransform( mesh, i, _normalVector );

				}

				if ( tangent ) {

					boneNormalTransform( mesh, i, _tangentVector );

				}

			}

			// update the vectors of the attributes
			if ( applyWorldTransforms ) {

				_positionVector.applyMatrix4( mesh.matrixWorld );

			}

			targetAttributes.position.setXYZ( i, _positionVector.x, _positionVector.y, _positionVector.z );

			if ( normal ) {

				if ( applyWorldTransforms ) {

					_normalVector.applyNormalMatrix( normalMatrix );

				}

				targetAttributes.normal.setXYZ( i, _normalVector.x, _normalVector.y, _normalVector.z );

			}

			if ( tangent ) {

				if ( applyWorldTransforms ) {

					_tangentVector.transformDirection( mesh.matrixWorld );

				}

				// a mirrored transform flips the tangent frame handedness so flip the bitangent sign
				// to keep the baked normal / tangent / bitangent frame consistent with the rendered one
				const tangentW = tangentMirrored ? - _tangentVector4.w : _tangentVector4.w;
				targetAttributes.tangent.setXYZW( i, _tangentVector.x, _tangentVector.y, _tangentVector.z, tangentW );

			}

		}

		// copy other attributes over
		for ( const i in this.attributes ) {

			const key = this.attributes[ i ];
			if ( key === 'position' || key === 'tangent' || key === 'normal' || ! ( key in attributes ) ) {

				continue;

			}

			if ( ! targetAttributes[ key ] ) {

				targetGeometry.setAttribute( key, createAttributeClone( attributes[ key ] ) );

			}

			validateAttributes( attributes[ key ], targetAttributes[ key ] );
			copyAttributeContents( attributes[ key ], targetAttributes[ key ] );

		}

		// flipping the winding order only makes sense if the vertices were actually mirrored by
		// the world transform - otherwise the baked geometry is in local space and unchanged
		if ( applyWorldTransforms && mesh.matrixWorld.determinant() < 0 ) {

			invertGeometry( targetGeometry );

		}

		return targetGeometry;

	}

}
