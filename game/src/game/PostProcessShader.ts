import { Camera, PostProcess, Engine, Effect } from '@babylonjs/core';

type UniformValue = number | [number, number];

export class PostProcessShader {
    private postProcess: PostProcess | null = null;
    private uniforms: { [key: string]: UniformValue } = {};
    private engine: Engine | null = null;

    /**
     * Load fragment shader code from a file
     */
    async loadShaderFromFile(filePath: string): Promise<string> {
        try {
            const response = await fetch(filePath);
            if (!response.ok) {
                throw new Error(
                    `Failed to load shader: ${response.status} ${response.statusText}`
                );
            }
            const shaderCode = await response.text();
            console.log(`Shader loaded from ${filePath}`);
            return shaderCode;
        } catch (error) {
            console.error(`Failed to load shader from ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Create and attach a post-processing shader to a camera
     */
    createPostProcess(
        camera: Camera,
        engine: Engine,
        fragmentShaderCode: string,
        uniforms?: { [key: string]: UniformValue }
    ) {
        this.engine = engine;
        const shaderName = 'customPostProcess';

        // Register fragment shader
        Effect.ShadersStore[`${shaderName}FragmentShader`] =
            fragmentShaderCode;

        // Create PostProcess
        this.postProcess = new PostProcess(
            shaderName,
            shaderName,
            Object.keys(uniforms || {}), // uniform names
            [], // samplers
            1, // ratio
            camera
        );

        // Store initial uniform values
        if (uniforms) {
            for (const [key, value] of Object.entries(uniforms)) {
                this.uniforms[key] = value;
            }
        }

        // Set up the onApply handler to update all uniforms each frame
        this.postProcess.onApply = (effect) => {
            // Always pass current resolution
            if ('resolution' in this.uniforms) {
                const w = this.engine!.getRenderWidth();
                const h = this.engine!.getRenderHeight();
                effect.setFloat2('resolution', w, h);
            }

            for (const [key, value] of Object.entries(this.uniforms)) {
                if (key === 'resolution') continue; // handled above
                if (typeof value === 'number') {
                    effect.setFloat(key, value);
                } else if (Array.isArray(value)) {
                    effect.setFloat2(key, value[0], value[1]);
                }
            }
        };

        return this.postProcess;
    }

    /**
     * Update a uniform value
     */
    setUniform(name: string, value: UniformValue) {
        this.uniforms[name] = value;
    }

    /**
     * Dispose of the post process
     */
    dispose() {
        if (this.postProcess) {
            this.postProcess.dispose();
            this.postProcess = null;
        }
    }

    /**
     * Get the post process instance
     */
    getPostProcess(): PostProcess | null {
        return this.postProcess;
    }
}
