import { describe, it, expect, beforeEach } from 'vitest';
import { CollisionPhysics } from '../game/CollisionPhysics';
import { Vector3 } from '@babylonjs/core';

describe('Vehicle Physics', () => {
    describe('CollisionPhysics', () => {
        let physics: CollisionPhysics;

        beforeEach(() => {
            physics = new CollisionPhysics();
        });

        it('should calculate momentum to velocity conversion', () => {
            const momentum = new Vector3(10, 0, 0);
            const mass = 1000;

            const velocity = physics.momentumToVelocity(momentum, mass);
            expect(velocity.x).toBeCloseTo(0.01);
            expect(velocity.y).toBeCloseTo(0);
            expect(velocity.z).toBeCloseTo(0);
        });

        it('should calculate velocity to momentum conversion', () => {
            const velocity = new Vector3(1, 0, 0);
            const mass = 1000;

            const momentum = physics.velocityToMomentum(velocity, mass);
            expect(momentum.x).toBeCloseTo(1000);
            expect(momentum.y).toBeCloseTo(0);
            expect(momentum.z).toBeCloseTo(0);
        });

        it('should apply friction to momentum', () => {
            const momentum = new Vector3(100, 0, 0);
            const deltaTime = 1; // 1 second

            const newMomentum = physics.applyMomentumFriction(
                momentum,
                deltaTime
            );
            // Default friction is 0.4, so after 1 second: momentum * (1 - 0.4) = 60
            expect(newMomentum.x).toBeCloseTo(60);
        });

        it('should zero out negligible momentum', () => {
            const momentum = new Vector3(0.01, 0, 0); // Below threshold
            const deltaTime = 1;

            const newMomentum = physics.applyMomentumFriction(
                momentum,
                deltaTime
            );
            expect(newMomentum.length()).toBeLessThan(0.001);
        });

        it('should calculate collision normal', () => {
            const pos1 = new Vector3(0, 0, 0);
            const pos2 = new Vector3(1, 0, 0);

            const normal = physics.calculateCollisionNormal(pos1, pos2);
            expect(normal.x).toBeCloseTo(1);
            expect(normal.y).toBeCloseTo(0);
            expect(normal.z).toBeCloseTo(0);
        });

        it('should handle zero mass division', () => {
            const momentum = new Vector3(10, 0, 0);
            const mass = 0;

            const velocity = physics.momentumToVelocity(momentum, mass);
            expect(velocity.x).toBeCloseTo(0);
            expect(velocity.y).toBeCloseTo(0);
            expect(velocity.z).toBeCloseTo(0);
        });

        it('should detect negligible momentum', () => {
            const negligibleMomentum = new Vector3(0.01, 0, 0);
            const normalMomentum = new Vector3(10, 0, 0);

            expect(physics.isMomentumNegligible(negligibleMomentum)).toBe(true);
            expect(physics.isMomentumNegligible(normalMomentum)).toBe(false);
        });

        it('should apply momentum friction progressively', () => {
            const momentum = new Vector3(100, 0, 0);

            let currentMomentum = momentum.clone();
            for (let i = 0; i < 5; i++) {
                currentMomentum = physics.applyMomentumFriction(
                    currentMomentum,
                    0.1
                );
            }

            // After 5 iterations of 0.1s with friction 0.4:
            // momentum * (1 - 0.4*0.1)^5 = 100 * (0.96)^5 ≈ 81.5
            expect(currentMomentum.x).toBeCloseTo(81.5, 0);
        });

        it('should calculate static collision momentum reflection', () => {
            const body = {
                velocity: new Vector3(1, 0, 0),
                mass: 1000,
                position: new Vector3(0, 0, 0),
            };
            const collisionNormal = new Vector3(1, 0, 0);

            const resultMomentum = physics.calculateStaticCollision(
                body,
                collisionNormal
            );

            // Velocity along normal is 1
            // Reflected momentum: (1000 - 2*1*1000) * damping = -1000 * 0.4 = -400
            expect(resultMomentum.x).toBeCloseTo(-400);
        });
    });
});
