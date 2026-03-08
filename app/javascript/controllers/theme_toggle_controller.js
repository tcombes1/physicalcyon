import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["icon"]

  connect() {
    this._update()
  }

  toggle() {
    const dark = document.documentElement.classList.toggle("dark")
    localStorage.setItem("theme", dark ? "dark" : "light")
    this._update()
  }

  _update() {
    const dark = document.documentElement.classList.contains("dark")
    if (this.hasIconTarget) {
      this.iconTarget.textContent = dark ? "☀" : "☾"
    }
  }
}
