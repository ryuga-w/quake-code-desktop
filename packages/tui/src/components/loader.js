import { Text } from "./text.js";
/**
 * Loader component that updates every 80ms with spinning animation
 */
export class Loader extends Text {
    spinnerColorFn;
    messageColorFn;
    message;
    currentFrame = 0;
    intervalId = null;
    ui = null;
    constructor(ui, spinnerColorFn, messageColorFn, message = "Loading...") {
        super("", 0, 0);
        this.spinnerColorFn = spinnerColorFn;
        this.messageColorFn = messageColorFn;
        this.message = message;
        this.ui = ui;
        this.start();
    }
    render(width) {
        return ["", ...super.render(width)];
    }
    start() {
        this.updateDisplay();
        this.intervalId = setInterval(() => {
            this.currentFrame++;
            this.updateDisplay();
        }, 100); // 100ms
    }
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    setMessage(message) {
        this.message = message;
        this.updateDisplay();
    }
    updateDisplay() {
        const isBlinkOn = Math.floor(this.currentFrame / 6) % 2 === 0;
        const left = isBlinkOn ? "●" : "○";
        this.setText(`${this.spinnerColorFn(left)} ${this.messageColorFn(this.message)}`);
        if (this.ui) {
            this.ui.requestRender();
        }
    }
}
//# sourceMappingURL=loader.js.map