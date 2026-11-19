import {
	SkinnedMesh, AnimationMixer, Raycaster, MeshBasicMaterial,
	BufferGeometry, BufferAttribute, Uint16BufferAttribute,
	Bone, Skeleton, FrontSide, BackSide, DoubleSide,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { validateBounds, SkinnedMeshBVH } from 'three-mesh-bvh';
import { skinnedMeshAcceleratedRaycast } from '../example/src/BVHRaycastUtils.js';
import { random, runTestMatrix, setSeed } from './utils.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// GLTFLoader accesses `self` and `self.URL` when building object URLs for embedded textures
globalThis.self = globalThis;

// ImageBitmapLoader calls createImageBitmap on the fetched blob; stub it so no canvas is needed
globalThis.createImageBitmap = async () => ( { width: 1, height: 1, close() {} } );

SkinnedMesh.prototype.raycast = skinnedMeshAcceleratedRaycast;

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const glbPath = path.join( __dirname, 'data', 'Soldier.glb' );

runTestMatrix( {
	indirect: [ false, true ],
}, ( desc, options ) => {

	describe( `Running with Options: { ${ desc } }`, () => runSuiteWithOptions( options ) );

} );

runTestMatrix( {
	indirect: [ false, true ],
}, ( desc, options ) => {

	describe( `Geometry Groups and Material Arrays with Options: { ${ desc } }`, () => runGroupSuiteWithOptions( options ) );

} );

function loadModel() {

	return new Promise( ( resolve, reject ) => {

		const data = fs.readFileSync( glbPath );
		const loader = new GLTFLoader();
		loader.parse( data.buffer, '', resolve, reject );

	} );

}

function runSuiteWithOptions( options ) {

	const transformSeed = Math.floor( Math.random() * 1e10 );
	describe( `Transform Seed : ${ transformSeed }`, () => {

		let meshes, bvhs, raycaster;

		beforeAll( async () => {

			setSeed( transformSeed );

			const gltf = await loadModel();

			// Replace materials so texture loading failures don't matter
			gltf.scene.traverse( child => {

				if ( child.isMesh ) {

					child.material = new MeshBasicMaterial( { side: child.material.side } );

				}

			} );

			// Advance animation 1 ("Run") to an interesting frame
			const mixer = new AnimationMixer( gltf.scene );
			const action = mixer.clipAction( gltf.animations[ 1 ] );
			action.play();
			mixer.update( 0.5 );
			gltf.scene.updateMatrixWorld( true );

			// Collect all skinned meshes and build a BVH for each
			meshes = [];
			bvhs = [];

			gltf.scene.traverse( child => {

				if ( child.isSkinnedMesh ) {

					const bvh = new SkinnedMeshBVH( child, options );
					child.boundsTree = bvh;
					meshes.push( child );
					bvhs.push( bvh );

				}

			} );

			raycaster = new Raycaster();

		} );

		for ( let i = 0; i < 100; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				setSeed( raySeed );
				random();

				raycaster.ray.origin.randomDirection().multiplyScalar( 2 );
				raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

				meshes.forEach( ( mesh, m ) => mesh.boundsTree = bvhs[ m ] );
				raycaster.firstHitOnly = false;
				const bvhHits = raycaster.intersectObjects( meshes );

				meshes.forEach( ( mesh, m ) => mesh.boundsTree = bvhs[ m ] );
				raycaster.firstHitOnly = true;
				const firstHit = raycaster.intersectObjects( meshes );

				meshes.forEach( mesh => mesh.boundsTree = null );
				raycaster.firstHitOnly = false;
				const ogHits = raycaster.intersectObjects( meshes );

				bvhs.forEach( bvh => expect( validateBounds( bvh ) ).toBeTruthy() );
				expect( ogHits ).toEqual( bvhHits );
				expect( ogHits[ 0 ] ).toEqual( firstHit[ 0 ] );

			} );

		}

	} );

}

// Creates a skinned mesh with geometry groups and a material array. Triangles
// 0 - 2 belong to material 0, triangles 3 - 5 to material 1, and triangles 2 - 5
// additionally overlap with material 2. Triangles 6 - 7 belong to no group and
// should not be raycast against.
function createGroupedSkinnedMesh() {

	// deterministic pseudo random generator so the geometry is stable across runs
	let seed = 123456789;
	const rand = () => {

		seed = ( seed * 1103515245 + 12345 ) % 2e31;
		return seed / 2e31;

	};

	const triCount = 8;
	const vertexCount = triCount * 3;
	const positions = new Float32Array( vertexCount * 3 );
	const normals = new Float32Array( vertexCount * 3 );
	const uvs = new Float32Array( vertexCount * 2 );
	const uv1s = new Float32Array( vertexCount * 2 );
	const skinIndices = new Uint16Array( vertexCount * 4 );
	const skinWeights = new Float32Array( vertexCount * 4 );

	for ( let i = 0; i < vertexCount; i ++ ) {

		positions[ i * 3 + 0 ] = ( rand() - 0.5 ) * 2;
		positions[ i * 3 + 1 ] = ( rand() - 0.5 ) * 2;
		positions[ i * 3 + 2 ] = ( rand() - 0.5 ) * 2;

		const nx = rand() - 0.5;
		const ny = rand() - 0.5;
		const nz = rand() - 0.5;
		const nl = Math.sqrt( nx * nx + ny * ny + nz * nz ) || 1;
		normals[ i * 3 + 0 ] = nx / nl;
		normals[ i * 3 + 1 ] = ny / nl;
		normals[ i * 3 + 2 ] = nz / nl;

		uvs[ i * 2 + 0 ] = rand();
		uvs[ i * 2 + 1 ] = rand();
		uv1s[ i * 2 + 0 ] = rand();
		uv1s[ i * 2 + 1 ] = rand();

		// weight the first half of the vertices to bone 0 and the rest to bone 1
		skinIndices[ i * 4 ] = i < vertexCount / 2 ? 0 : 1;
		skinWeights[ i * 4 ] = 1;

	}

	const index = new Uint16Array( vertexCount );
	for ( let i = 0; i < vertexCount; i ++ ) {

		index[ i ] = i;

	}

	const geometry = new BufferGeometry();
	geometry.setIndex( new BufferAttribute( index, 1 ) );
	geometry.setAttribute( 'position', new BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new BufferAttribute( uvs, 2 ) );
	geometry.setAttribute( 'uv1', new BufferAttribute( uv1s, 2 ) );
	geometry.setAttribute( 'skinIndex', new Uint16BufferAttribute( skinIndices, 4 ) );
	geometry.setAttribute( 'skinWeight', new BufferAttribute( skinWeights, 4 ) );

	geometry.addGroup( 0, 9, 0 );
	geometry.addGroup( 9, 9, 1 );
	geometry.addGroup( 6, 12, 2 );

	const material = [
		new MeshBasicMaterial( { side: FrontSide } ),
		new MeshBasicMaterial( { side: BackSide } ),
		new MeshBasicMaterial( { side: DoubleSide } ),
	];

	const bone0 = new Bone();
	const bone1 = new Bone();
	bone0.add( bone1 );
	bone1.position.x = 0.5;

	const mesh = new SkinnedMesh( geometry, material );
	mesh.add( bone0 );
	mesh.updateMatrixWorld( true );
	mesh.bind( new Skeleton( [ bone0, bone1 ] ) );

	return mesh;

}

function runGroupSuiteWithOptions( options ) {

	const transformSeed = Math.floor( Math.random() * 1e10 );
	describe( `Transform Seed : ${ transformSeed }`, () => {

		let mesh, bvh, raycaster;

		beforeAll( () => {

			setSeed( transformSeed );

			mesh = createGroupedSkinnedMesh();

			// pose the skeleton
			mesh.skeleton.bones[ 0 ].rotation.x = 0.3;
			mesh.skeleton.bones[ 1 ].rotation.z = 0.6;
			mesh.updateMatrixWorld( true );
			mesh.skeleton.update();

			bvh = new SkinnedMeshBVH( mesh, options );
			mesh.boundsTree = bvh;

			raycaster = new Raycaster();

		} );

		function getRaycastResults() {

			mesh.boundsTree = bvh;
			raycaster.firstHitOnly = false;
			const bvhHits = raycaster.intersectObject( mesh );

			mesh.boundsTree = bvh;
			raycaster.firstHitOnly = true;
			const firstHit = raycaster.intersectObject( mesh );

			mesh.boundsTree = null;
			raycaster.firstHitOnly = false;
			const ogHits = raycaster.intersectObject( mesh );

			return { ogHits, bvhHits, firstHit };

		}

		function randomizeRay() {

			raycaster.ray.origin.randomDirection().multiplyScalar( 2 );
			raycaster.ray.direction.copy( raycaster.ray.origin ).multiplyScalar( - 1 ).normalize();

		}

		for ( let i = 0; i < 50; i ++ ) {

			const raySeed = Math.floor( Math.random() * 1e10 );
			it( `Cast ${ i } Seed : ${ raySeed }`, () => {

				setSeed( raySeed );
				random();
				randomizeRay();

				const { ogHits, bvhHits, firstHit } = getRaycastResults();
				expect( validateBounds( bvh ) ).toBeTruthy();
				expect( ogHits ).toEqual( bvhHits );
				expect( ogHits[ 0 ] ).toEqual( firstHit[ 0 ] );

			} );

		}

		describe( 'After Refit', () => {

			beforeAll( () => {

				// change the pose and refit the BVH bounds
				mesh.skeleton.bones[ 0 ].rotation.x = - 0.5;
				mesh.skeleton.bones[ 1 ].rotation.z = - 0.9;
				mesh.updateMatrixWorld( true );
				mesh.skeleton.update();
				bvh.refit();

				// force the native raycast bounding sphere to be recomputed
				mesh.boundingSphere = null;

			} );

			for ( let i = 0; i < 50; i ++ ) {

				const raySeed = Math.floor( Math.random() * 1e10 );
				it( `Cast ${ i } Seed : ${ raySeed }`, () => {

					setSeed( raySeed );
					random();
					randomizeRay();

					const { ogHits, bvhHits, firstHit } = getRaycastResults();
					expect( validateBounds( bvh ) ).toBeTruthy();
					expect( ogHits ).toEqual( bvhHits );
					expect( ogHits[ 0 ] ).toEqual( firstHit[ 0 ] );

				} );

			}

		} );

	} );

}
