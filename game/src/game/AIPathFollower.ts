import {
    Scene,
    Vector3,
    Quaternion,
    VertexBuffer,
    AbstractMesh,
    SceneLoader,
    TransformNode,
} from '@babylonjs/core';
import { VehicleConfig } from './VehicleConfig';

interface AIVehicle {
    rootNode: TransformNode;
    distanceTraveled: number;
    speed: number;
}

export class AIPathFollower {
    private scene: Scene;
    private waypoints: Vector3[] = [];
    private cumulativeDistances: number[] = [];
    private totalLength: number = 0;
    private aiVehicles: AIVehicle[] = [];

    constructor(scene: Scene) {
        this.scene = scene;
        this.extractPath();
    }

    private extractPath() {
        const pathMesh = this.scene.getMeshByName('ai_path') as AbstractMesh;
        if (!pathMesh) {
            console.warn('AIPathFollower: no "ai_path" mesh found in scene');
            return;
        }

        const positions = pathMesh.getVerticesData(VertexBuffer.PositionKind);
        if (!positions || positions.length < 6) {
            console.warn('AIPathFollower: ai_path has insufficient vertices');
            return;
        }

        // Extract vertices as Vector3, applying the mesh's world matrix
        const worldMatrix = pathMesh.computeWorldMatrix(true);
        const vertexCount = positions.length / 3;
        for (let i = 0; i < vertexCount; i++) {
            const local = new Vector3(
                positions[i * 3],
                positions[i * 3 + 1],
                positions[i * 3 + 2]
            );
            const world = Vector3.TransformCoordinates(local, worldMatrix);
            this.waypoints.push(world);
        }

        // Precompute cumulative distances
        this.cumulativeDistances.push(0);
        for (let i = 1; i < this.waypoints.length; i++) {
            const segLen = Vector3.Distance(
                this.waypoints[i - 1],
                this.waypoints[i]
            );
            this.cumulativeDistances.push(
                this.cumulativeDistances[i - 1] + segLen
            );
        }
        this.totalLength =
            this.cumulativeDistances[this.cumulativeDistances.length - 1];

        // Hide the path mesh
        pathMesh.setEnabled(false);

        // Log first few waypoints for debugging height/position
        for (let i = 0; i < Math.min(5, this.waypoints.length); i++) {
            const w = this.waypoints[i];
            console.log(`  waypoint[${i}]: (${w.x.toFixed(2)}, ${w.y.toFixed(2)}, ${w.z.toFixed(2)})`);
        }
        console.log(
            `AIPathFollower: extracted ${this.waypoints.length} waypoints, total path length: ${this.totalLength.toFixed(2)}`
        );
    }

    async spawnAIVehicle(config: VehicleConfig, speed: number, startOffset: number = 0) {
        if (this.waypoints.length < 2) return;

        // Load the model directly — bypass Vehicle class to avoid surface detection / height offset
        const rootNode = new TransformNode(config.id, this.scene);
        try {
            const container = await SceneLoader.LoadAssetContainerAsync(
                '/world/vehicles/',
                config.modelFile,
                this.scene
            );
            container.addAllToScene();
            for (const mesh of container.meshes) {
                mesh.parent = rootNode;
            }
            if (container.meshes.length > 0) {
                container.meshes[0].rotation.y = config.model.rotationY;
                container.meshes[0].rotation.z = config.model.rotationZ;
                const scale = config.model.scale;
                for (const mesh of container.meshes) {
                    mesh.scaling.scaleInPlace(scale);
                }
            }
        } catch (error) {
            console.error(`Failed to load AI vehicle model: ${config.modelFile}`, error);
            return;
        }

        const ai: AIVehicle = {
            rootNode,
            distanceTraveled: startOffset % this.totalLength,
            speed,
        };
        this.aiVehicles.push(ai);

        // Position immediately
        this.positionVehicle(ai);
    }

    update(deltaTime: number) {
        for (const ai of this.aiVehicles) {
            ai.distanceTraveled += ai.speed * deltaTime;
            // Loop
            if (ai.distanceTraveled >= this.totalLength) {
                ai.distanceTraveled -= this.totalLength;
            }
            this.positionVehicle(ai);
        }
    }

    private getWaypoint(index: number): Vector3 {
        return this.waypoints[index % this.waypoints.length];
    }

    private positionVehicle(ai: AIVehicle) {
        const d = ai.distanceTraveled;
        const n = this.waypoints.length;

        // Find the segment we're on via binary search
        let lo = 0;
        let hi = this.cumulativeDistances.length - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (this.cumulativeDistances[mid] <= d) {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        const i1 = lo;
        const i2 = (i1 + 1) % n;
        const i0 = (i1 - 1 + n) % n;
        const i3 = (i1 + 2) % n;
        const segLength =
            this.cumulativeDistances[Math.min(i1 + 1, this.cumulativeDistances.length - 1)] -
            this.cumulativeDistances[i1];
        const t =
            segLength > 0
                ? (d - this.cumulativeDistances[i1]) / segLength
                : 0;

        // Catmull-Rom spline through 4 points: curve goes from P1 to P2 as t: 0→1
        const p0 = this.getWaypoint(i0);
        const p1 = this.getWaypoint(i1);
        const p2 = this.getWaypoint(i2);
        const p3 = this.getWaypoint(i3);

        const t2 = t * t;
        const t3 = t2 * t;

        // P(t) = 0.5 * ((2*P1) + (-P0+P2)*t + (2*P0-5*P1+4*P2-P3)*t² + (-P0+3*P1-3*P2+P3)*t³)
        const position = p1.scale(2)
            .add(p2.subtract(p0).scale(t))
            .add(p0.scale(2).subtract(p1.scale(5)).add(p2.scale(4)).subtract(p3).scale(t2))
            .add(p0.scale(-1).add(p1.scale(3)).subtract(p2.scale(3)).add(p3).scale(t3))
            .scale(0.5);

        // Tangent: P'(t) = 0.5 * ((-P0+P2) + 2*(2*P0-5*P1+4*P2-P3)*t + 3*(-P0+3*P1-3*P2+P3)*t²)
        const forward = p2.subtract(p0)
            .add(p0.scale(2).subtract(p1.scale(5)).add(p2.scale(4)).subtract(p3).scale(2 * t))
            .add(p0.scale(-1).add(p1.scale(3)).subtract(p2.scale(3)).add(p3).scale(3 * t2))
            .scale(0.5)
            .normalize();

        // Yaw (left/right) and pitch (up/down) from the tangent vector
        const yaw = Math.atan2(forward.x, forward.z);
        const pitch = -Math.asin(Math.max(-1, Math.min(1, forward.y)));

        ai.rootNode.position = position;
        ai.rootNode.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, pitch, 0);
    }

    isReady(): boolean {
        return this.waypoints.length >= 2;
    }

    getTotalLength(): number {
        return this.totalLength;
    }
}
