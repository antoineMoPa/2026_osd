import { describe, it, expect, beforeEach } from 'vitest';
import { InputManager } from '../game/InputManager';

describe('InputManager', () => {
    let canvas: HTMLCanvasElement;
    let inputManager: InputManager;

    beforeEach(() => {
        // Create a mock canvas
        canvas = document.createElement('canvas');
        inputManager = new InputManager(canvas);
    });

    it('should initialize with default values', () => {
        const input = inputManager.getInput();
        expect(input.accelerate).toBe(0);
        expect(input.steer).toBe(0);
        expect(input.handbrake).toBe(false);
    });

    it('should detect W key for acceleration', () => {
        const event = new KeyboardEvent('keydown', { code: 'KeyW' });
        window.dispatchEvent(event);

        const input = inputManager.getInput();
        expect(input.accelerate).toBe(1);
    });

    it('should detect S key for reverse', () => {
        const event = new KeyboardEvent('keydown', { code: 'KeyS' });
        window.dispatchEvent(event);

        const input = inputManager.getInput();
        expect(input.accelerate).toBe(-1);
    });

    it('should detect A key for left steering', () => {
        const event = new KeyboardEvent('keydown', { code: 'KeyA' });
        window.dispatchEvent(event);

        const input = inputManager.getInput();
        expect(input.steer).toBe(1);
    });

    it('should detect D key for right steering', () => {
        const event = new KeyboardEvent('keydown', { code: 'KeyD' });
        window.dispatchEvent(event);

        const input = inputManager.getInput();
        expect(input.steer).toBe(-1);
    });

    it('should detect Space for handbrake', () => {
        const event = new KeyboardEvent('keydown', { code: 'Space' });
        window.dispatchEvent(event);

        const input = inputManager.getInput();
        expect(input.handbrake).toBe(true);
    });

    it('should reset keys on keyup', () => {
        // Key down
        let event = new KeyboardEvent('keydown', { code: 'KeyW' });
        window.dispatchEvent(event);
        let input = inputManager.getInput();
        expect(input.accelerate).toBe(1);

        // Key up
        event = new KeyboardEvent('keyup', { code: 'KeyW' });
        window.dispatchEvent(event);
        input = inputManager.getInput();
        expect(input.accelerate).toBe(0);
    });

    it('should handle arrow keys for movement', () => {
        const upEvent = new KeyboardEvent('keydown', { code: 'ArrowUp' });
        window.dispatchEvent(upEvent);

        let input = inputManager.getInput();
        expect(input.accelerate).toBe(1);

        const downEvent = new KeyboardEvent('keydown', { code: 'ArrowDown' });
        window.dispatchEvent(downEvent);

        input = inputManager.getInput();
        expect(input.accelerate).toBe(-1);
    });
});
