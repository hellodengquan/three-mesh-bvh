import {
	Bone,
	BufferAttribute,
	BufferGeometry,
	Mesh,
	MeshBasicMaterial,
	Skeleton,
	SkinnedMesh,
	Vector3,
} from 'three';
import { StaticGeometryGenerator } from 'three-mesh-bvh';

// Returns a flat triangle geometry with position, normal, and tangent attributes
function createTriangle() {

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [
		0, 0, 0,
		1, 0, 0,
		0, 1, 0,
	] ), 3 ) );
	geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( [
		0, 0, 1,
		0, 0, 1,
		0, 0, 1,
	] ), 3 ) );
	geometry.setAttribute( 'tangent', new BufferAttribute( new Float32Array( [
		1, 0, 0, 1,
		1, 0, 0, 1,
		1, 0, 0, 1,
	] ), 4 ) );
	geometry.setIndex( new BufferAttribute( new Uint16Array( [ 0, 1, 2 ] ), 1 ) );
	return geometry;

}

// Returns a triangle geometry with a morph target for each of the baked attributes
function createMorphGeometry() {

	const geometry = createTriangle();
	const count = geometry.attributes.position.count;

	const morphPosition = new BufferAttribute( new Float32Array( count * 3 ).map( ( v, i ) => i % 3 === 0 ? 3 : 0 ), 3 );
	const morphNormal = new BufferAttribute( new Float32Array( count * 3 ).map( ( v, i ) => i % 3 === 0 ? 1 : 0 ), 3 );
	const morphTangent = new BufferAttribute( new Float32Array( count * 4 ).map( ( v, i ) => i % 4 === 1 ? 1 : 0 ), 4 );
	geometry.morphAttributes.position = [ morphPosition ];
	geometry.morphAttributes.normal = [ morphNormal ];
	geometry.morphAttributes.tangent = [ morphTangent ];
	geometry.morphTargetsRelative = true;

	return geometry;

}

// Returns an indexed triangle geometry with skin attributes
function createSkinnedGeometry() {

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [
		0, 0, 0,
		1, 0, 0,
		0, 1, 0,
		0, 0, 1,
	] ), 3 ) );
	geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( [
		0, 0, 1,
		0, 0, 1,
		0, 0, 1,
		0, 0, 1,
	] ), 3 ) );
	geometry.setAttribute( 'skinIndex', new BufferAttribute( new Uint16Array( 16 ), 4 ) );
	geometry.setAttribute( 'skinWeight', new BufferAttribute( new Float32Array( [
		1, 0, 0, 0,
		1, 0, 0, 0,
		1, 0, 0, 0,
		1, 0, 0, 0,
	] ), 4 ) );
	geometry.setIndex( new BufferAttribute( new Uint16Array( [ 0, 1, 2, 0, 2, 3 ] ), 1 ) );
	return geometry;

}

// Returns a skinned mesh with two bones
function createSkinnedMesh() {

	const geometry = createSkinnedGeometry();
	const bone = new Bone();
	const child = new Bone();
	bone.add( child );

	const mesh = new SkinnedMesh( geometry, new MeshBasicMaterial() );
	mesh.add( bone );
	mesh.bind( new Skeleton( [ bone, child ] ) );
	mesh.updateMatrixWorld( true );

	return mesh;

}

function getWindingSign( geometry ) {

	const position = geometry.attributes.position;
	const index = geometry.index;
	const a = new Vector3().fromBufferAttribute( position, index.getX( 0 ) );
	const b = new Vector3().fromBufferAttribute( position, index.getX( 1 ) );
	const c = new Vector3().fromBufferAttribute( position, index.getX( 2 ) );

	return Math.sign( b.clone().sub( a ).cross( c.clone().sub( a ) ).z );

}

describe( 'StaticGeometryGenerator', () => {

	describe( 'morph target updates', () => {

		it( 'should regenerate positions, normals, and tangents when only the morph weights change.', () => {

			const geometry = createMorphGeometry();
			const mesh = new Mesh( geometry, new MeshBasicMaterial() );
			mesh.updateMorphTargets();
			mesh.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( mesh );
			const target = generator.generate();

			const initialX = target.attributes.position.getX( 0 );
			const initialNormalZ = target.attributes.normal.getZ( 0 );
			const initialTangentY = target.attributes.tangent.getY( 0 );

			// update the weight without touching the skeleton, world matrix, or geometry
			mesh.morphTargetInfluences[ 0 ] = 1;
			generator.generate( target );

			expect( target.attributes.position.getX( 0 ) ).toBeCloseTo( initialX + 3 );
			expect( target.attributes.normal.getZ( 0 ) ).not.toBeCloseTo( initialNormalZ );
			expect( target.attributes.tangent.getY( 0 ) ).not.toBeCloseTo( initialTangentY );

			// update again with a partial weight
			mesh.morphTargetInfluences[ 0 ] = 0.5;
			generator.generate( target );

			expect( target.attributes.position.getX( 0 ) ).toBeCloseTo( initialX + 1.5 );

		} );

		it( 'should skip meshes that have not changed.', () => {

			const geometry = createMorphGeometry();
			const mesh = new Mesh( geometry, new MeshBasicMaterial() );
			mesh.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( mesh );
			const target = generator.generate();

			// poison the output so any rewrite is detected, then generate without changes
			target.attributes.position.setX( 0, - 100 );
			generator.generate( target );

			expect( target.attributes.position.getX( 0 ) ).toBe( - 100 );

			// changing the morph weight must force a rewrite
			mesh.morphTargetInfluences[ 0 ] = 1;
			generator.generate( target );

			expect( target.attributes.position.getX( 0 ) ).not.toBe( - 100 );

		} );

	} );

	describe( 'skinned mesh updates', () => {

		it( 'should update vertices when the bone pose changes.', () => {

			const mesh = createSkinnedMesh();
			const generator = new StaticGeometryGenerator( mesh );
			const target = generator.generate();

			const initialX = target.attributes.position.getX( 0 );

			mesh.skeleton.bones[ 0 ].position.set( 5, 0, 0 );
			mesh.updateMatrixWorld( true );

			generator.generate( target );

			expect( target.attributes.position.getX( 0 ) ).toBeCloseTo( initialX + 5 );

		} );

		it( 'should bake meshes again when a new target geometry is provided.', () => {

			const geometry = createMorphGeometry();
			const mesh = new Mesh( geometry, new MeshBasicMaterial() );
			mesh.updateMorphTargets();
			mesh.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( mesh );
			const first = generator.generate();

			// generating into a fresh geometry must fully bake the meshes again rather than
			// skipping them because the source meshes have not changed
			const second = generator.generate();

			expect( Array.from( second.attributes.position.array ) ).toEqual( Array.from( first.attributes.position.array ) );
			expect( Array.from( second.index.array ) ).toEqual( Array.from( first.index.array ) );

		} );

	} );

	describe( 'per mesh skipping', () => {

		it( 'should only rewrite the data of meshes whose animation state changed.', () => {

			const morphGeometry = createMorphGeometry();
			const morphMesh = new Mesh( morphGeometry, new MeshBasicMaterial() );
			morphMesh.updateMorphTargets();
			morphMesh.updateMatrixWorld( true );

			const staticGeometry = createTriangle();
			const staticMesh = new Mesh( staticGeometry, new MeshBasicMaterial() );
			staticMesh.position.set( 10, 0, 0 );
			staticMesh.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( [ morphMesh, staticMesh ] );
			const target = generator.generate();

			// the second mesh's vertices start at the first geometry's vertex count
			const staticVertexOffset = morphGeometry.attributes.position.count;
			const initialStaticX = target.attributes.position.getX( staticVertexOffset );

			// poison the second mesh's baked data so an unnecessary rewrite is visible
			target.attributes.position.setX( staticVertexOffset, - 100 );

			// changing only the first mesh's morph weight must not touch the second mesh's data
			morphMesh.morphTargetInfluences[ 0 ] = 1;
			generator.generate( target );

			expect( target.attributes.position.getX( staticVertexOffset ) ).toBe( - 100 );
			expect( target.attributes.position.getX( 0 ) ).toBeCloseTo( 3 );

			// restoring the poisoned value and generating again should still be a no-op
			target.attributes.position.setX( staticVertexOffset, initialStaticX );
			generator.generate( target );
			expect( target.attributes.position.getX( staticVertexOffset ) ).toBeCloseTo( initialStaticX );

		} );

	} );

	describe( 'mirrored geometry', () => {

		it( 'should not flip the winding order in local space.', () => {

			const geometry = createTriangle();
			const mesh = new Mesh( geometry, new MeshBasicMaterial() );
			mesh.scale.set( - 1, 1, 1 );
			mesh.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( mesh );
			generator.applyWorldTransforms = false;

			const target = generator.generate();
			expect( getWindingSign( target ) ).toBe( getWindingSign( geometry ) );
			expect( target.index.getX( 0 ) ).toBe( 0 );
			expect( target.index.getX( 2 ) ).toBe( 2 );

		} );

		it( 'should flip the winding order when world transforms are applied.', () => {

			const geometry = createTriangle();
			const mesh = new Mesh( geometry, new MeshBasicMaterial() );
			mesh.scale.set( - 1, 1, 1 );
			mesh.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( mesh );
			const target = generator.generate();

			// the mirrored world transform flips the triangle so the winding needs to be reversed
			// as well to keep the front face pointing in the same direction
			expect( target.index.getX( 0 ) ).toBe( 2 );
			expect( target.index.getX( 2 ) ).toBe( 0 );

		} );

		it( 'should flip the tangent handedness when world transforms are applied to a mirrored mesh.', () => {

			const geometry = createTriangle();
			const mesh = new Mesh( geometry, new MeshBasicMaterial() );
			mesh.scale.set( - 1, 1, 1 );
			mesh.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( mesh );
			const target = generator.generate();

			// the tangent is mirrored and the winding order is reversed so the bitangent sign must
			// flip to keep cross( normal, tangent ) * w pointing the same way as the original mesh
			expect( target.attributes.tangent.getZ( 0 ) ).toBeCloseTo( 0 );
			expect( target.attributes.tangent.getW( 0 ) ).toBe( - 1 );

			const normal = new Vector3().fromBufferAttribute( target.attributes.normal, 0 );
			const tangent = new Vector3().fromBufferAttribute( target.attributes.tangent, 0 );
			const bitangent = normal.clone().cross( tangent ).multiplyScalar( target.attributes.tangent.getW( 0 ) );

			const sourceNormal = new Vector3().fromBufferAttribute( geometry.attributes.normal, 0 );
			const sourceTangent = new Vector3().fromBufferAttribute( geometry.attributes.tangent, 0 );
			const sourceBitangent = sourceNormal.clone().cross( sourceTangent ).multiplyScalar( geometry.attributes.tangent.getW( 0 ) );
			sourceBitangent.transformDirection( mesh.matrixWorld );

			expect( bitangent.x ).toBeCloseTo( sourceBitangent.x );
			expect( bitangent.y ).toBeCloseTo( sourceBitangent.y );
			expect( bitangent.z ).toBeCloseTo( sourceBitangent.z );

		} );

		it( 'should update the merged index when the mirroring of a mesh changes.', () => {

			const geometry = createTriangle();
			const mesh = new Mesh( geometry, new MeshBasicMaterial() );
			mesh.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( mesh );
			generator.applyWorldTransforms = false;
			const target = generator.generate();
			expect( target.index.getX( 0 ) ).toBe( 0 );

			// mirroring the mesh should not change the local space index
			mesh.scale.set( - 1, 1, 1 );
			mesh.updateMatrixWorld( true );
			generator.generate( target );
			expect( target.index.getX( 0 ) ).toBe( 0 );

			// but enabling world transforms should now flip the index in place
			generator.applyWorldTransforms = true;
			generator.generate( target );
			expect( target.index.getX( 0 ) ).toBe( 2 );

		} );

		it( 'should update the merged index for only the mirrored mesh.', () => {

			const triangleA = createTriangle();
			const meshA = new Mesh( triangleA, new MeshBasicMaterial() );
			meshA.updateMatrixWorld( true );

			const triangleB = createTriangle();
			const meshB = new Mesh( triangleB, new MeshBasicMaterial() );
			meshB.position.set( 5, 0, 0 );
			meshB.updateMatrixWorld( true );

			const generator = new StaticGeometryGenerator( [ meshA, meshB ] );
			const target = generator.generate();
			expect( Array.from( target.index.array ) ).toEqual( [ 0, 1, 2, 3, 4, 5 ] );

			// mirroring the second mesh must only reverse its own triangle, leaving the first alone
			meshB.scale.set( - 1, 1, 1 );
			meshB.updateMatrixWorld( true );
			generator.generate( target );

			expect( Array.from( target.index.array ) ).toEqual( [ 0, 1, 2, 5, 4, 3 ] );

		} );

		it( 'should write the merged index at the right offset past skipped meshes.', () => {

			const meshes = [];
			for ( let i = 0; i < 3; i ++ ) {

				const mesh = new Mesh( createTriangle(), new MeshBasicMaterial() );
				mesh.position.set( i * 5, 0, 0 );
				mesh.updateMatrixWorld( true );
				meshes.push( mesh );

			}

			const generator = new StaticGeometryGenerator( meshes );
			const target = generator.generate();
			expect( Array.from( target.index.array ) ).toEqual( [ 0, 1, 2, 3, 4, 5, 6, 7, 8 ] );

			// mirror only the last mesh - the first two are skipped so the updated index data must
			// still be written at their merged offset rather than the start of the buffer
			meshes[ 2 ].scale.set( - 1, 1, 1 );
			meshes[ 2 ].updateMatrixWorld( true );
			generator.generate( target );

			expect( Array.from( target.index.array ) ).toEqual( [ 0, 1, 2, 3, 4, 5, 8, 7, 6 ] );

		} );

	} );

} );
