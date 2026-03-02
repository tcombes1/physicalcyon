import { Controller } from "@hotwired/stimulus"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

export default class extends Controller {
  static values = { url: String }

  connect() {
    this._setupScene()
    this._loadModel()
    this._setupResizeObserver()
  }

  disconnect() {
    this._cleanup()
  }

  _setupScene() {
    const el = this.element

    this._renderer = new THREE.WebGLRenderer({ antialias: true })
    this._renderer.setPixelRatio(window.devicePixelRatio)
    this._renderer.setSize(el.clientWidth, el.clientHeight)
    this._renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(this._renderer.domElement)

    this._scene = new THREE.Scene()
    this._scene.background = new THREE.Color(0xf0f0f0)

    this._camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.01, 10000)
    this._camera.position.set(0, 0, 5)

    this._scene.add(new THREE.AmbientLight(0xffffff, 0.6))

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0)
    dirLight1.position.set(5, 10, 7)
    this._scene.add(dirLight1)

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4)
    dirLight2.position.set(-5, -5, -5)
    this._scene.add(dirLight2)

    this._controls = new OrbitControls(this._camera, this._renderer.domElement)
    this._controls.enableDamping = true
    this._controls.dampingFactor = 0.08

    this._renderer.setAnimationLoop(() => {
      this._controls.update()
      this._renderer.render(this._scene, this._camera)
    })
  }

  _loadModel() {
    const loader = new GLTFLoader()
    loader.load(
      this.urlValue,
      (gltf) => {
        const model = gltf.scene
        this._scene.add(model)

        // Fit camera to bounding box
        const box = new THREE.Box3().setFromObject(model)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const fov = this._camera.fov * (Math.PI / 180)
        const distance = Math.abs(maxDim / Math.sin(fov / 2)) * 0.75

        this._camera.position.copy(center)
        this._camera.position.z += distance
        this._camera.near = distance / 100
        this._camera.far = distance * 100
        this._camera.updateProjectionMatrix()

        this._controls.target.copy(center)
        this._controls.update()
      },
      undefined,
      (err) => console.error("GLTFLoader error:", err)
    )
  }

  _setupResizeObserver() {
    this._resizeObserver = new ResizeObserver(() => this._onResize())
    this._resizeObserver.observe(this.element)
  }

  _onResize() {
    const el = this.element
    const w = el.clientWidth
    const h = el.clientHeight
    this._camera.aspect = w / h
    this._camera.updateProjectionMatrix()
    this._renderer.setSize(w, h)
  }

  _cleanup() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
      this._resizeObserver = null
    }
    if (this._renderer) {
      this._renderer.setAnimationLoop(null)
      this._renderer.dispose()
      this._renderer.domElement.remove()
      this._renderer = null
    }
    this._scene = null
    this._camera = null
    this._controls = null
  }
}
