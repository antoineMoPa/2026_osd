import {
    Scene,
    Vector3,
    TransformNode,
    Quaternion,
    SceneLoader,
    AbstractMesh,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { VehicleConfig } from './VehicleConfig';
import { CollisionPhysics } from './CollisionPhysics';

// Surface types the vehicle can drive on
type SurfaceType = 'planet' | 'ground';

export class Vehicle {
    private scene: Scene;
    rootNode!: TransformNode;

    private position: Vector3 = new Vector3(0, 0, 0);
    private speed: number = 0;
    private velocity: Vector3 = Vector3.Zero(); // Controlled driving velocity
    private momentum: Vector3 = Vector3.Zero(); // Collision momentum (global coords)
    private mass: number = 1000; // kg - default mass for vehicles
    private maxSpeed: number;
    private acceleration: number;
    private friction: number;
    private steerAngle: number = 0;
    private maxSteerAngle: number;

    private inputAccelerate: number = 0;
    private inputSteer: number = 0;
    private inputHandbrake: boolean = false;

    // Surface geometry — auto-detected from scene meshes
    private surfaceType: SurfaceType = 'ground';
    // Planet mode fields
    private planetRadius: number = 0;
    private planetCenter: Vector3 = Vector3.Zero();
    // Ground mode fields
    private groundHeight: number = 0;

    private heightOffset: number;
    private config: VehicleConfig;
    private overrideScale?: number;
    private collisionPhysics: CollisionPhysics;
    private modelBasePath: string;

    constructor(
        scene: Scene,
        config: VehicleConfig,
        overrideScale?: number,
        modelBasePath: string = '/world/vehicles/'
    ) {
        this.scene = scene;
        this.config = config;
        this.modelBasePath = modelBasePath;
        this.overrideScale = overrideScale;
        this.collisionPhysics = new CollisionPhysics();

        // Initialize physics properties from config
        this.maxSpeed = config.physics.maxSpeed;
        this.acceleration = config.physics.acceleration;
        this.friction = config.physics.friction;
        this.maxSteerAngle = config.physics.maxSteerAngle;
        this.heightOffset = config.physics.heightOffset;
        this.mass = config.physics.mass ?? 1000; // Default 1000kg if not specified
    }

    async create(existingMesh?: AbstractMesh) {
        if (existingMesh) {
            await this.useExistingMesh(existingMesh);
        } else {
            await this.loadVehicleModel();
        }

        this.detectSurface();

        if (existingMesh) {
            // Don't call positionOnGround() — keep the vehicle where it already is
            this.position = this.rootNode.position.clone();

            if (this.surfaceType === 'planet') {
                // Calculate the ACTUAL height offset from the existing position
                // so the physics doesn't reposition it
                const currentDistance = Vector3.Distance(
                    this.position,
                    this.planetCenter
                );
                this.heightOffset = currentDistance - this.planetRadius;
                console.log(
                    `Calculated height offset from existing position: ${this.heightOffset}`
                );
            }
        } else {
            this.positionOnGround();
        }
    }

    private async useExistingMesh(mesh: AbstractMesh) {
        // Use the existing mesh as our rootNode
        if (mesh.parent) {
            this.rootNode = mesh.parent as TransformNode;
        } else {
            this.rootNode = mesh as TransformNode;
        }

        console.log(`Using existing mesh for ${this.config.name}`);

        // Initialize rotation quaternion if not set
        if (!this.rootNode.rotationQuaternion) {
            this.rootNode.rotationQuaternion = Quaternion.FromEulerAngles(
                this.rootNode.rotation.x,
                this.rootNode.rotation.y,
                this.rootNode.rotation.z
            );
        }
    }

    private async loadVehicleModel() {
        try {
            const container = await SceneLoader.LoadAssetContainerAsync(
                this.modelBasePath,
                this.config.modelFile,
                this.scene
            );

            // Create a parent transform node to hold the rotated model
            this.rootNode = new TransformNode(this.config.id, this.scene);

            // Add all meshes from the container to the scene
            container.addAllToScene();

            // Parent all loaded meshes to our transform node
            const meshes = container.meshes;
            if (meshes.length > 0) {
                for (const mesh of meshes) {
                    mesh.parent = this.rootNode;
                }

                // Apply Z rotation to correct model orientation
                meshes[0].rotation.z = this.config.model.rotationZ;

                // Apply scale from config or override
                const scale = this.overrideScale ?? this.config.model.scale;
                for (const mesh of meshes) {
                    mesh.scaling.scaleInPlace(scale);
                }

                console.log(
                    `Loaded ${this.config.name} from ${this.config.modelFile} (scale: ${scale})`
                );
            } else {
                console.error(`No meshes found in ${this.config.modelFile}`);
            }
        } catch (error) {
            console.error(`Failed to load ${this.config.modelFile}:`, error);
            this.rootNode = new TransformNode(this.config.id, this.scene);
        }
    }

    /**
     * Auto-detect the surface type from scene meshes.
     * If a "Planet" mesh exists, use sphere physics.
     * If a "Ground" mesh exists, use flat ground physics.
     * Defaults to ground mode if neither is found.
     */
    private detectSurface() {
        const planetMesh = this.scene.getMeshByName('Planet');
        const groundMesh = this.scene.getMeshByName('Ground');

        if (planetMesh) {
            this.surfaceType = 'planet';
            this.planetCenter = planetMesh.position.clone();

            // Calculate radius from initial vehicle position to planet center
            this.position = this.rootNode.position.clone();
            this.planetRadius = Vector3.Distance(
                this.position,
                this.planetCenter
            );

            console.log(
                `Detected planet surface — center: ${this.planetCenter}, radius: ${this.planetRadius}`
            );
        } else {
            this.surfaceType = 'ground';

            if (groundMesh) {
                this.groundHeight = groundMesh.position.y;
                console.log(
                    `Detected flat ground surface — height: ${this.groundHeight}`
                );
            } else {
                this.groundHeight = 0;
                console.log(
                    'No Planet or Ground mesh found, defaulting to flat ground at y=0'
                );
            }
        }
    }

    private positionOnGround() {
        if (this.surfaceType === 'planet') {
            // Position on planet sphere surface, adjusted for height offset
            const direction = this.rootNode.position
                .subtract(this.planetCenter)
                .normalize();
            const targetDistance = this.planetRadius + this.heightOffset;
            this.position = this.planetCenter.add(
                direction.scale(targetDistance)
            );
        } else {
            // Position on flat ground
            this.position = new Vector3(
                0,
                this.groundHeight + this.heightOffset,
                0
            );
        }

        this.rootNode.position = this.position;

        // Initialize rotation quaternion if not set
        if (!this.rootNode.rotationQuaternion) {
            this.rootNode.rotationQuaternion = Quaternion.Identity();
        }

        console.log('Vehicle positioned at:', this.position);
    }

    update(deltaTime: number) {
        this.updateMovement(deltaTime);
        this.updatePosition(deltaTime);
    }

    private updateMovement(deltaTime: number) {
        // Apply handbrake if engaged
        if (this.inputHandbrake) {
            // Progressive deceleration — stronger braking force
            const brakingForce = 30; // Higher value for faster stopping
            const speedSign = Math.sign(this.speed);
            const brakingAmount = brakingForce * deltaTime;

            // Reduce speed progressively, but don't overshoot zero
            if (Math.abs(this.speed) <= brakingAmount) {
                this.speed = 0;
            } else {
                this.speed -= speedSign * brakingAmount;
            }
        } else {
            // Normal acceleration
            this.speed += this.inputAccelerate * this.acceleration * deltaTime;
            this.speed = Math.max(
                -this.maxSpeed * 0.5,
                Math.min(this.maxSpeed, this.speed)
            );
            this.speed *= Math.pow(this.friction, deltaTime);
        }

        // Update steering with speed-based curve
        const absSpeed = Math.abs(this.speed);

        // No turning when stopped
        if (absSpeed < 0.5) {
            this.steerAngle = 0;
        } else {
            this.steerAngle = this.inputSteer * this.maxSteerAngle * this.speed;
        }
    }

    private updatePosition(deltaTime: number) {
        if (this.surfaceType === 'planet') {
            this.updatePositionPlanet(deltaTime);
        } else {
            this.updatePositionGround(deltaTime);
        }
    }

    /**
     * Flat ground movement: simple XZ plane translation + Y-axis steering rotation.
     * Momentum is applied as a velocity offset on the same plane.
     */
    private updatePositionGround(deltaTime: number) {
        // Update momentum friction
        this.updateMomentum(deltaTime);

        const currentRotation =
            this.rootNode.rotationQuaternion || Quaternion.Identity();

        // Get current forward direction (local Z axis rotated by current orientation)
        const localForward = new Vector3(0, 0, 1);
        const forward = new Vector3();
        localForward.rotateByQuaternionToRef(currentRotation, forward);

        // Calculate driving velocity from player controls
        const drivingVelocity = forward.scale(this.speed);

        // Convert momentum (kg·m/s) to velocity (m/s) by dividing by mass
        const momentumVelocity = this.collisionPhysics.momentumToVelocity(
            this.momentum,
            this.mass
        );

        // Total velocity = driving + momentum velocity
        this.velocity = drivingVelocity.add(momentumVelocity);

        // If total velocity is very small, stop
        if (this.velocity.length() < 0.1) {
            this.velocity = Vector3.Zero();
            return;
        }

        // Move on XZ plane
        this.position.addInPlace(this.velocity.scale(deltaTime));

        // Clamp to ground height
        this.position.y = this.groundHeight + this.heightOffset;

        // Apply steering — rotate around world Y axis
        const steeringRotation = Quaternion.RotationAxis(
            Vector3.Up(),
            this.steerAngle * deltaTime
        );
        const newRotation = steeringRotation.multiply(currentRotation);

        this.rootNode.rotationQuaternion = newRotation;
        this.rootNode.position = this.position;
    }

    /**
     * Sphere/planet movement: vehicle drives along the surface of a sphere,
     * orientation automatically aligns to the surface normal.
     * Momentum is applied in global coords and projected onto the sphere tangent.
     */
    private updatePositionPlanet(deltaTime: number) {
        // Update momentum friction
        this.updateMomentum(deltaTime);

        const currentRotation =
            this.rootNode.rotationQuaternion || Quaternion.Identity();

        // Get the surface normal (direction from planet center to vehicle)
        const surfaceNormal = this.position
            .subtract(this.planetCenter)
            .normalize();

        // Get current forward direction (local Z axis rotated by current orientation)
        const localForward = new Vector3(0, 0, 1);
        const forward = new Vector3();
        localForward.rotateByQuaternionToRef(currentRotation, forward);

        // Calculate driving velocity from player controls
        const drivingVelocity = forward.scale(this.speed);

        // Convert momentum (kg·m/s) to velocity (m/s) by dividing by mass
        const momentumVelocity = this.collisionPhysics.momentumToVelocity(
            this.momentum,
            this.mass
        );

        // Total velocity = driving + momentum velocity
        this.velocity = drivingVelocity.add(momentumVelocity);

        // If total velocity is very small, stop
        if (this.velocity.length() < 0.1) {
            this.velocity = Vector3.Zero();
            return;
        }

        // Project forward direction onto the tangent plane of the sphere
        // tangentForward = forward - (forward · normal) * normal
        const dotProduct = Vector3.Dot(forward, surfaceNormal);
        const tangentForward = forward
            .subtract(surfaceNormal.scale(dotProduct))
            .normalize();

        // Apply steering by rotating around the vehicle's local up vector (not world-space surface normal)
        // This ensures steering feels correct regardless of position on planet
        const localUp = new Vector3(0, 1, 0);
        const worldUp = new Vector3();
        localUp.rotateByQuaternionToRef(currentRotation, worldUp);

        const steeringRotation = Quaternion.RotationAxis(
            worldUp,
            this.steerAngle * deltaTime
        );
        const newRotation = steeringRotation.multiply(currentRotation);

        // Move along the sphere surface
        // Convert linear speed to angular displacement on sphere
        const angularDisplacement =
            (this.speed * deltaTime) / this.planetRadius;

        // Rotate position around planet center using the tangent forward direction
        const rotationAxis = Vector3.Cross(
            surfaceNormal,
            tangentForward
        ).normalize();
        const movementRotation = Quaternion.RotationAxis(
            rotationAxis,
            angularDisplacement
        );

        // Apply rotation to position vector (relative to planet center)
        const relativePosition = this.position.subtract(this.planetCenter);
        const newRelativePosition = new Vector3();
        relativePosition.rotateByQuaternionToRef(
            movementRotation,
            newRelativePosition
        );
        this.position = this.planetCenter.add(newRelativePosition);

        // Ensure position stays at exact planet radius + height offset
        const targetDistance = this.planetRadius + this.heightOffset;
        const currentDistance = Vector3.Distance(
            this.position,
            this.planetCenter
        );
        if (Math.abs(currentDistance - targetDistance) > 0.001) {
            const correctedDirection = this.position
                .subtract(this.planetCenter)
                .normalize();
            this.position = this.planetCenter.add(
                correctedDirection.scale(targetDistance)
            );
        }

        // Update orientation to align with surface
        // The "up" direction should point away from planet center (surface normal)
        const newSurfaceNormal = this.position
            .subtract(this.planetCenter)
            .normalize();
        const alignmentRotation = this.createAlignmentRotation(
            newRotation,
            newSurfaceNormal
        );

        this.rootNode.rotationQuaternion = alignmentRotation;
        this.rootNode.position = this.position;
    }

    /**
     * Calculate rotation that aligns the vehicle's up vector with the given surface normal.
     * Used by planet mode to keep the vehicle oriented to the sphere surface.
     */
    private createAlignmentRotation(
        currentRotation: Quaternion,
        surfaceNormal: Vector3
    ): Quaternion {
        // Get the current "up" direction from the rotation
        const localUp = new Vector3(0, 1, 0);
        const currentUp = new Vector3();
        localUp.rotateByQuaternionToRef(currentRotation, currentUp);

        // Calculate rotation needed to align current up with surface normal
        const rotationAxis = Vector3.Cross(currentUp, surfaceNormal);
        const rotationAxisLength = rotationAxis.length();

        if (rotationAxisLength < 0.0001) {
            // Already aligned or opposite direction
            return currentRotation;
        }

        const angle = Math.asin(Math.min(1, rotationAxisLength));
        const alignmentQuat = Quaternion.RotationAxis(
            rotationAxis.normalize(),
            angle
        );

        return alignmentQuat.multiply(currentRotation);
    }

    setInput(accelerate: number, steer: number, handbrake: boolean = false) {
        this.inputAccelerate = accelerate;
        this.inputSteer = steer;
        this.inputHandbrake = handbrake;
    }

    stopMovement() {
        this.speed = 0;
    }

    getMesh(): TransformNode {
        return this.rootNode;
    }

    getSpeed(): number {
        return this.speed;
    }

    getPlanetCenter(): Vector3 {
        return this.planetCenter;
    }

    getPlanetRadius(): number {
        return this.planetRadius;
    }

    getPosition(): Vector3 {
        return this.position.clone();
    }

    setPosition(position: Vector3) {
        this.position = position.clone();
        this.rootNode.position = position.clone();
    }

    getDirection(): Vector3 {
        const currentRotation =
            this.rootNode.rotationQuaternion || Quaternion.Identity();
        const localForward = new Vector3(0, 0, 1);
        const forward = new Vector3();
        localForward.rotateByQuaternionToRef(currentRotation, forward);
        return forward;
    }

    setVisible(visible: boolean) {
        this.rootNode.setEnabled(visible);
    }

    getConfig(): VehicleConfig {
        return this.config;
    }

    getName(): string {
        return this.config.name;
    }

    /**
     * Get velocity in world space
     * (velocity is already calculated in world space during updatePosition)
     */
    getVelocity(): Vector3 {
        return this.velocity.clone();
    }

    /**
     * Set velocity in world space
     */
    setVelocity(velocity: Vector3) {
        this.velocity = velocity.clone();
        // Update speed to match velocity magnitude
        this.speed = this.velocity.length();
    }

    getMass(): number {
        return this.mass;
    }

    /**
     * Get current momentum in world space
     */
    getMomentum(): Vector3 {
        return this.momentum.clone();
    }

    /**
     * Set momentum directly (used for collisions)
     * Momentum is in world space and independent of driving controls
     */
    setMomentum(momentum: Vector3) {
        this.momentum = momentum.clone();
    }

    /**
     * Apply collision: transfer momentum and stop driving
     * @param impulse - Impulse to apply (force * time)
     */
    applyCollisionImpulse(impulse: Vector3) {
        // Convert impulse to momentum change (momentum = mass * velocity, impulse = force * time)
        const momentumChange = impulse;
        this.momentum.addInPlace(momentumChange);

        // Stop driving — collision takes over control
        this.speed = 0;

        console.log(
            `Vehicle collision: momentum now (${this.momentum.x.toFixed(2)}, ${this.momentum.y.toFixed(2)}, ${this.momentum.z.toFixed(2)}) | magnitude: ${this.momentum.length().toFixed(2)}`
        );
    }

    /**
     * Update momentum with friction (called each frame)
     */
    updateMomentum(deltaTime: number) {
        this.momentum = this.collisionPhysics.applyMomentumFriction(
            this.momentum,
            deltaTime
        );
    }

    getSurfaceType(): SurfaceType {
        return this.surfaceType;
    }
}
