import { Vector3 } from '@babylonjs/core';

/**
 * Represents an object involved in collision physics calculations
 */
export interface PhysicsBody {
    velocity: Vector3;
    mass: number;
    position: Vector3;
}

/**
 * Result of a collision calculation
 */
export interface CollisionResult {
    body1NewVelocity: Vector3;
    body2NewVelocity: Vector3;
    impulse: Vector3;
    shouldSeparate: boolean;
}

/**
 * Configuration for collision physics
 */
export interface CollisionConfig {
    restitution?: number; // Bounciness (0 = perfectly inelastic, 1 = perfectly elastic)
    staticObjectDamping?: number; // Damping for static object collisions
    momentumFriction?: number; // Friction applied to momentum per second
    momentumThreshold?: number; // Minimum momentum magnitude before zeroing
}

/**
 * CollisionPhysics handles all collision and momentum calculations
 * for vehicle-to-vehicle and vehicle-to-static-object collisions
 */
export class CollisionPhysics {
    private restitution: number;
    private staticObjectDamping: number;
    private momentumFriction: number;
    private momentumThreshold: number;

    constructor(config: CollisionConfig = {}) {
        this.restitution = config.restitution ?? 0.3;
        this.staticObjectDamping = config.staticObjectDamping ?? 0.4;
        this.momentumFriction = config.momentumFriction ?? 0.4;
        this.momentumThreshold = config.momentumThreshold ?? 0.05;
    }

    /**
     * Calculate collision between a moving body and a static object
     * Static objects don't move, so we only need to reflect the body's momentum
     */
    calculateStaticCollision(
        body: PhysicsBody,
        collisionNormal: Vector3
    ): Vector3 {
        const v = body.velocity;

        // Calculate momentum (mass * velocity)
        const currentMomentum = v.scale(body.mass);

        // Reflect momentum along collision normal (opposite direction)
        const velocityAlongNormal = Vector3.Dot(v, collisionNormal);
        const reflectedMomentum = currentMomentum.subtract(
            collisionNormal.scale(2 * velocityAlongNormal * body.mass)
        );

        // Apply damping (lose energy in collision)
        const dampedMomentum = reflectedMomentum.scale(
            this.staticObjectDamping
        );

        return dampedMomentum;
    }

    /**
     * Calculate collision between two moving bodies
     * Returns new velocities for both bodies
     */
    calculateDynamicCollision(
        body1: PhysicsBody,
        body2: PhysicsBody,
        collisionNormal: Vector3
    ): CollisionResult {
        const v1 = body1.velocity;
        const v2 = body2.velocity;
        const m1 = body1.mass;
        const m2 = body2.mass;

        // Calculate relative velocity
        const relativeVelocity = v1.subtract(v2);
        const velocityAlongNormal = Vector3.Dot(
            relativeVelocity,
            collisionNormal
        );

        // Normal points FROM body1 TO body2
        // If velocity along normal is POSITIVE, body1 is moving toward body2 (approaching)
        // If velocity along normal is NEGATIVE, body1 is moving away from body2 (separating)
        const isApproaching = velocityAlongNormal > 0;

        // Calculate impulse magnitude using coefficient of restitution
        const e = this.restitution;
        const j = (-(1 + e) * velocityAlongNormal) / (1 / m1 + 1 / m2);

        // Apply impulse to both bodies
        // Normal points from body1->body2
        // j is negative for approaching collisions, so impulse points from body2 back to body1
        const impulse = collisionNormal.scale(j);

        // Calculate new velocities
        // For approaching collision: j < 0, so impulse points backward (opposite to normal)
        // body1: add negative impulse to slow it down
        // body2: subtract negative impulse (= add positive) to push it forward
        const body1NewVelocity = v1.add(impulse.scale(1 / m1));
        const body2NewVelocity = v2.add(impulse.scale(-1 / m2));

        return {
            body1NewVelocity,
            body2NewVelocity,
            impulse,
            shouldSeparate: isApproaching,
        };
    }

    /**
     * Calculate collision normal between two positions
     * Normal points from position1 to position2
     */
    calculateCollisionNormal(position1: Vector3, position2: Vector3): Vector3 {
        return position2.subtract(position1).normalize();
    }

    /**
     * Apply momentum friction over time
     * Returns the updated momentum vector
     */
    applyMomentumFriction(momentum: Vector3, deltaTime: number): Vector3 {
        // Apply linear drag
        const dragFactor = 1.0 - this.momentumFriction * deltaTime;
        const newMomentum = momentum.scale(Math.max(0, dragFactor));

        // Zero out very small momentum
        if (newMomentum.length() < this.momentumThreshold) {
            return Vector3.Zero();
        }

        return newMomentum;
    }

    /**
     * Calculate separation positions for two colliding bodies
     * Returns the separation distances for each body
     */
    calculateSeparation(
        mass1: number,
        mass2: number,
        separationDistance: number,
        isInterpenetrating: boolean = false
    ): { body1Separation: number; body2Separation: number } {
        const separationMultiplier = isInterpenetrating ? 2.0 : 1.0;
        const totalMass = mass1 + mass2;

        return {
            body1Separation:
                (mass2 / totalMass) * separationDistance * separationMultiplier,
            body2Separation:
                (mass1 / totalMass) * separationDistance * separationMultiplier,
        };
    }

    /**
     * Calculate reverse impulse for interpenetrating objects
     * Used when objects are stuck inside each other
     */
    calculateReverseImpulse(
        velocity: Vector3,
        mass: number,
        collisionNormal: Vector3
    ): Vector3 {
        return collisionNormal.scale(velocity.length() * mass * -1);
    }

    /**
     * Convert impulse to momentum change
     */
    impulseToMomentum(impulse: Vector3): Vector3 {
        return impulse.clone();
    }

    /**
     * Convert velocity to momentum
     */
    velocityToMomentum(velocity: Vector3, mass: number): Vector3 {
        return velocity.scale(mass);
    }

    /**
     * Convert momentum to velocity
     */
    momentumToVelocity(momentum: Vector3, mass: number): Vector3 {
        if (mass === 0) return Vector3.Zero();
        return momentum.scale(1 / mass);
    }

    /**
     * Check if momentum is below threshold
     */
    isMomentumNegligible(momentum: Vector3): boolean {
        return momentum.length() < this.momentumThreshold;
    }
}
