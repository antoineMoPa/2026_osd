import {
    Scene,
    Engine,
    Vector3,
    SceneLoader,
    HemisphericLight,
    PointLight,
    FreeCamera,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { Vehicle } from './Vehicle';
import { InputManager } from './InputManager';
import { VehicleConfigLoader } from './VehicleConfig';

export class Game {
    private engine: Engine;
    private scene: Scene;
    private camera!: FreeCamera;
    private vehicle: Vehicle | null = null;
    private inputManager: InputManager;

    constructor(_canvas: HTMLCanvasElement, engine: Engine) {
        this.engine = engine;
        this.scene = new Scene(engine);
        this.inputManager = new InputManager(_canvas);
        this.setupScene();
    }

    private setupScene() {
        // Set background color
        this.scene.clearColor.copyFromFloats(0.1, 0.1, 0.1, 1.0);

        // Add ambient light
        const ambientLight = new HemisphericLight(
            'ambientLight',
            new Vector3(1, 1, 1),
            this.scene
        );
        ambientLight.intensity = 0.7;

        // Add directional light
        const dirLight = new PointLight(
            'dirLight',
            new Vector3(5, 10, 5),
            this.scene
        );
        dirLight.intensity = 0.8;
        dirLight.range = 100;

        // Add follow camera
        this.camera = new FreeCamera(
            'followCamera',
            new Vector3(0, 10, -15),
            this.scene
        );

        console.log('Scene setup complete');
    }

    private updateFollowingCamera() {
        if (!this.vehicle) return;

        const activeMesh = this.vehicle.getMesh();
        const activePosition = activeMesh.getAbsolutePosition();
        const activeRotation = activeMesh.absoluteRotationQuaternion;

        const localUp = new Vector3(0, 1, 0);
        const localForward = new Vector3(0, 0, 1);

        const vehicleUp = new Vector3();
        const forward = new Vector3();

        localUp.rotateByQuaternionToRef(activeRotation, vehicleUp);
        localForward.rotateByQuaternionToRef(activeRotation, forward);

        const up = vehicleUp;
        const backward = forward.scale(-1);

        const cameraDistance = 13;
        const cameraHeight = 3.5;
        const cameraPosition = activePosition
            .add(backward.normalize().scale(cameraDistance))
            .add(up.scale(cameraHeight));

        const speed = this.vehicle.getSpeed();
        const smoothFactor = Math.min(1, Math.abs(speed) / 3);
        const lerpSpeed = 0.02 + smoothFactor * 0.08;

        this.camera.position = Vector3.Lerp(
            this.camera.position,
            cameraPosition,
            lerpSpeed
        );

        const lookAtTarget = activePosition.add(up.scale(2));
        this.camera.upVector = up.clone();
        this.camera.setTarget(lookAtTarget);
    }

    async initialize() {
        try {
            // Load the main scene from world/scene.glb
            console.log('Loading scene.glb...');
            const sceneContainer = await SceneLoader.LoadAssetContainerAsync(
                '/world/',
                'scene.glb',
                this.scene
            );
            sceneContainer.addAllToScene();

            // Vehicle.ts will auto-detect the surface type:
            // - If scene contains a "Planet" mesh → sphere physics
            // - If scene contains a "Ground" mesh → flat ground physics
            console.log('Scene loaded successfully');

            // Load vehicle config
            console.log('Loading vehicle config...');
            const vehicleConfig =
                await VehicleConfigLoader.loadVehicleConfig('main_car');

            // Create vehicle
            console.log('Creating vehicle...');
            this.vehicle = new Vehicle(
                this.scene,
                vehicleConfig,
                undefined,
                '/world/vehicles/'
            );
            await this.vehicle.create();

            console.log('Vehicle created successfully');

            // Start the game loop
            this.startGameLoop();
            return true;
        } catch (error) {
            console.error('Failed to initialize game:', error);
            return false;
        }
    }

    private startGameLoop() {
        this.engine.runRenderLoop(() => {
            if (this.vehicle) {
                // Get input
                const input = this.inputManager.getInput();

                // Set vehicle input
                this.vehicle.setInput(
                    input.accelerate,
                    input.steer,
                    input.handbrake
                );

                // Update vehicle
                const deltaTime = this.engine.getDeltaTime() / 1000; // Convert to seconds
                this.vehicle.update(deltaTime);
            }

            // Update follow camera
            this.updateFollowingCamera();

            // Render scene
            this.scene.render();
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.engine.resize();
        });
    }

    stop() {
        this.engine.stopRenderLoop();
    }

    getScene(): Scene {
        return this.scene;
    }

    getVehicle(): Vehicle | null {
        return this.vehicle;
    }
}
