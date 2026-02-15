export class InputManager {
    private canvas: HTMLCanvasElement;
    private keys: { [key: string]: boolean } = {};

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        window.addEventListener('keydown', (event) => {
            // Ignore keyboard events when user is typing in an input field
            const target = event.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            const code = event.code.toLowerCase();
            this.keys[code] = true;
        });

        window.addEventListener('keyup', (event) => {
            this.keys[event.code.toLowerCase()] = false;
        });

        this.canvas.addEventListener('click', () => {
            this.canvas.focus();
        });

        this.canvas.tabIndex = 1;
    }

    getInput() {
        let accelerate = 0;
        let steer = 0;
        let handbrake = false;

        // Normal vehicle controls
        if (this.keys['keyw'] || this.keys['arrowup']) {
            accelerate = 1;
        }
        if (this.keys['keys'] || this.keys['arrowdown']) {
            accelerate = -1;
        }

        if (this.keys['keya'] || this.keys['arrowleft']) {
            steer = 1;
        }
        if (this.keys['keyd'] || this.keys['arrowright']) {
            steer = -1;
        }

        if (this.keys['space']) {
            handbrake = true;
        }

        return {
            accelerate,
            steer,
            handbrake,
        };
    }
}
