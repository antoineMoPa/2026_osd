export interface VehicleConfig {
    id: string;
    name: string;
    modelFile: string;
    physics: {
        maxSpeed: number;
        acceleration: number;
        friction: number;
        maxSteerAngle: number;
        heightOffset: number;
        mass?: number; // kg - mass of the vehicle for momentum calculations
    };
    model: {
        scale: number;
        rotationZ: number;
    };
}

export class VehicleConfigLoader {
    private static configCache: Map<string, VehicleConfig> = new Map();

    static async loadVehicleConfig(
        vehicleId: string,
        basePath: string = '/vehicles/'
    ): Promise<VehicleConfig> {
        // Check cache first
        const cacheKey = `${basePath}${vehicleId}.json`;
        if (this.configCache.has(cacheKey)) {
            return this.configCache.get(cacheKey)!;
        }

        try {
            const response = await fetch(`${basePath}${vehicleId}.json`);
            if (!response.ok) {
                throw new Error(
                    `Failed to load vehicle config: ${vehicleId} (${response.status})`
                );
            }

            const config = await response.json();
            this.configCache.set(cacheKey, config);
            return config;
        } catch (error) {
            console.error(
                `Failed to load vehicle config for ${vehicleId}:`,
                error
            );
            throw error;
        }
    }
}
