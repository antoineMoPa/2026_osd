import { Engine } from '@babylonjs/core';
import { Game } from './game/Game';

async function main() {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    const statusEl = document.getElementById('status') as HTMLElement;
    const controlsEl = document.getElementById('controls') as HTMLElement;

    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }

    try {
        statusEl.textContent = 'Initializing...';

        // Create Babylon.js engine
        const engine = new Engine(canvas, true);

        // Create and initialize game
        const game = new Game(canvas, engine);
        const success = await game.initialize();

        if (success) {
            statusEl.textContent = '';
            controlsEl.style.display = 'block';
        } else {
            statusEl.textContent = '✗ Failed to load game';
        }
    } catch (error) {
        console.error('Fatal error:', error);
        statusEl.textContent = '✗ Error: ' + (error as Error).message;
    }
}

main();
