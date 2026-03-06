import { Controller } from "@hotwired/stimulus"

// Polls the server every `interval` ms by reloading its turbo-frame.
// Stops automatically once the frame's `src` is cleared by the done/failed
// state response (Turbo propagates the absence of src from the response frame).
export default class extends Controller {
  static values = { interval: { type: Number, default: 3000 } }

  connect() {
    this._bound = this._checkDone.bind(this)
    this.element.addEventListener("turbo:frame-load", this._bound)
    this._timer = setInterval(() => this.element.reload(), this.intervalValue)
  }

  disconnect() {
    clearInterval(this._timer)
    this.element.removeEventListener("turbo:frame-load", this._bound)
  }

  _checkDone() {
    if (!this.element.src) clearInterval(this._timer)
  }
}
