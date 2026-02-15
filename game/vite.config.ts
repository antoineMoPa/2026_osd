import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    base: '/',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        fs: {
            allow: ['..'],
        },
    },
    optimizeDeps: {
        include: [
            '@babylonjs/core',
            '@babylonjs/loaders',
            '@babylonjs/materials',
        ],
    },
});
