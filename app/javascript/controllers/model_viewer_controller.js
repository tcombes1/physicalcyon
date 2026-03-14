import { Controller } from "@hotwired/stimulus"
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { LineSegments2 } from "three/addons/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"

// Direction vectors (center → camera) for each view preset.
// OCCT/STEP is Z-up; RWGltf_CafWriter preserves that convention.
const VIEW_DIRS = {
  xy:  new THREE.Vector3( 0,  0,  1),           // top-down   (XY plane)
  xz:  new THREE.Vector3( 0, -1,  0),           // front      (XZ plane)
  yz:  new THREE.Vector3( 1,  0,  0),           // right side (YZ plane)
  iso: new THREE.Vector3( 1, -1,  1).normalize(), // isometric
}

const ANIM_DURATION  = 550  // ms — view transition
const DRAG_THRESHOLD = 5    // px — below this a click+release counts as a pick
const EDGE_WIDTH     = 3  // px — world-space line width for edge overlays

// ── Palette color system ────────────────────────────────────────────────────
// Six palettes × three variants. Fill in hex values as 0xRRGGBB.
//   light mode: surface=300, edge=400
//   dark  mode: surface=400, edge=500

const PALETTE_NAMES = ['slate', 'stone', 'taupe', 'mauve', 'mist', 'olive']

const PALETTE_HEX = {
  //          300         400         500
  slate: { 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155" },
  stone: { 200: "#e7e5e4", 300: "#d6d3d1", 400: "#a8a29e", 500: "#78716c", 600: "#57534e", 700: "#44403c" },
  taupe: { 200: "#e8e4e3", 300: "#d8d2d0", 400: "#aba09c", 500: "#7c6d67", 600: "#5b4f4b", 700: "#473c39" },
  mauve: { 200: "#e7e4e7", 300: "#d7d0d7", 400: "#a89ea9", 500: "#79697b", 600: "#594c5b", 700: "#463947" },
  mist:  { 200: "#e3e7e8", 300: "#d0d6d8", 400: "#9ca8ab", 500: "#67787c", 600: "#4b585b", 700: "#394447" },
  olive: { 200: "#e8e8e3", 300: "#d8d8d0", 400: "#abab9c", 500: "#7c7c67", 600: "#5b5b4b", 700: "#474739" },
}

// Hex values are display sRGB; Three.js materials need linear sRGB internally.
function buildPaletteColors() {
  const colors = {}
  for (const [name, variants] of Object.entries(PALETTE_HEX)) {
    colors[name] = {}
    for (const [level, hex] of Object.entries(variants)) {
      colors[name][level] = new THREE.Color(hex).convertSRGBToLinear()
    }
  }
  return colors
}

export default class extends Controller {
  static values = { url: String }

  connect() {
    this._anim        = null
    this._modelCenter = new THREE.Vector3()
    this._modelDistance = 1
    this._loadedScene = null
    this._selection   = null   // { meshes: [{ mesh, origMat }] }
    this._mdX = 0; this._mdY = 0  // mousedown position for drag detection

    // Palette state
    this._paletteColors = buildPaletteColors()
    this._partColorMap  = new Map()  // node → { palette, isSurface, mat }
    this._edgeObjects   = []         // THREE.LineSegments added for edge overlay
    this._isDark        = null       // tracks last-seen theme; null forces initial apply

    this._setupScene()
    this._loadModel()
    this._setupResizeObserver()
  }

  disconnect() {
    this._cleanup()
  }

  // ── View preset action ──────────────────────────────────────────────────────

  setView(event) {
    const dir = VIEW_DIRS[event.params.view]
    if (!dir || !this._camera) return

    this._anim = {
      fromPos:    this._camera.position.clone(),
      fromTarget: this._controls.target.clone(),
      toPos:      this._modelCenter.clone().addScaledVector(dir, this._modelDistance),
      toTarget:   this._modelCenter.clone(),
      startTime:  performance.now(),
    }
  }

  // ── 90° rotation actions ────────────────────────────────────────────────────

  rotateX() { this._rotate90Around(new THREE.Vector3(1, 0, 0)) }
  rotateY() { this._rotate90Around(new THREE.Vector3(0, 1, 0)) }
  rotateZ() { this._rotate90Around(new THREE.Vector3(0, 0, 1)) }

  _rotate90Around(axis) {
    if (!this._camera) return
    const q      = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2)
    const relPos = this._camera.position.clone().sub(this._controls.target)
    relPos.applyQuaternion(q)
    this._anim = {
      fromPos:    this._camera.position.clone(),
      fromTarget: this._controls.target.clone(),
      toPos:      this._controls.target.clone().add(relPos),
      toTarget:   this._modelCenter.clone(),
      startTime:  performance.now(),
    }
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  _setupSelectionListeners() {
    const canvas = this._renderer.domElement

    this._onMouseDown = (e) => { this._mdX = e.clientX; this._mdY = e.clientY }

    this._onCanvasClick = (e) => {
      // Ignore if the mouse moved enough to count as a drag/orbit
      if (Math.hypot(e.clientX - this._mdX, e.clientY - this._mdY) > DRAG_THRESHOLD) return

      const hit = this._raycast(e)
      this._clearSelection()

      if (!hit) return

      const part = this._findPart(hit.object)

      if (e.detail === 2) {
        // Double-click → highlight the whole part (all meshes under the named ancestor)
        this._applyHighlight(part, /*fullGray*/ true)
      } else {
        // Single click → highlight just this surface mesh
        this._applyHighlight(hit.object, /*fullGray*/ false)
      }

      // Notify the part tree sidebar which part is active
      document.dispatchEvent(new CustomEvent('model-viewer:part-selected', {
        detail: { name: part.name || '' }
      }))
    }

    // Listen for part selections coming from the sidebar tree
    this._onPartTreeSelect = (e) => {
      if (!this._loadedScene) return
      const obj = this._loadedScene.getObjectByName(e.detail.name)
      if (!obj) return
      this._clearSelection()
      this._applyHighlight(obj, /*fullGray*/ true)
    }

    // Listen for visibility toggles from the sidebar tree
    this._onPartTreeToggleVisibility = (e) => {
      if (!this._loadedScene) return
      const obj = this._loadedScene.getObjectByName(e.detail.name)
      if (obj) obj.visible = e.detail.visible
    }

    canvas.addEventListener('mousedown', this._onMouseDown)
    canvas.addEventListener('click',     this._onCanvasClick)
    document.addEventListener('part-tree:select',             this._onPartTreeSelect)
    document.addEventListener('part-tree:toggle-visibility',  this._onPartTreeToggleVisibility)
  }

  // Build a nested tree of named nodes from the loaded scene graph.
  // Unnamed nodes (mesh primitives, anonymous groups) are skipped; their
  // named descendants are bubbled up to the nearest named ancestor.
  _buildPartTree(node) {
    const result = []
    for (const child of node.children) {
      // Skip LineSegments2 edge overlays we injected during color assignment
      if (child.type === 'LineSegments2') continue
      if (child.name) {
        result.push({ name: child.name, uuid: child.uuid, children: this._buildPartTree(child) })
      } else {
        result.push(...this._buildPartTree(child))
      }
    }
    return result
  }

  // Walk up from `mesh`'s PARENT to find the first named ancestor.
  // We skip the mesh itself because Three.js GLTFLoader names each primitive
  // within a multi-primitive mesh as "meshName_0", "meshName_1" etc., so
  // starting from the parent correctly lands on the Group that holds all
  // primitives of this part (e.g. the Group "nut" containing 8 face meshes).
  _findPart(mesh) {
    let obj = mesh.parent
    while (obj && obj !== this._loadedScene) {
      if (obj.name) return obj
      obj = obj.parent
    }
    return mesh  // fallback: no named ancestor found
  }

  // Apply a highlight material to every Mesh inside `root` (or to root itself).
  // fullGray=true  → complete luminance-only grayscale    (part selection)
  // fullGray=false → 65% desaturation + faint emissive lift (surface selection)
  _applyHighlight(root, fullGray) {
    const collected = []

    const apply = (node) => {
      if (!node.isMesh) return
      // origMat is the palette-colored material we assigned; restore it on clear.
      const origMat = node.material
      const hlMat   = origMat.clone()
      hlMat.color   = this._desaturate(origMat.color, fullGray ? 1.0 : 0.65)
      if (!fullGray) hlMat.emissive = new THREE.Color(0x1c1c1c)
      node.material = hlMat
      collected.push({ mesh: node, origMat })
    }

    if (root.isMesh) {
      apply(root)
    } else {
      root.traverse(apply)
    }

    this._selection = { meshes: collected }
  }

  _clearSelection() {
    if (!this._selection) return
    for (const { mesh, origMat } of this._selection.meshes) {
      mesh.material = origMat
    }
    this._selection = null
  }

  // Lerp a THREE.Color toward its luminance value by `amount` (0=original, 1=full gray)
  _desaturate(color, amount) {
    const luma = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
    return new THREE.Color(
      color.r + (luma - color.r) * amount,
      color.g + (luma - color.g) * amount,
      color.b + (luma - color.b) * amount,
    )
  }

  _raycast(event) {
    const canvas = this._renderer.domElement
    const rect   = canvas.getBoundingClientRect()
    const ndc    = new THREE.Vector2(
       ((event.clientX - rect.left) / rect.width)  * 2 - 1,
      -((event.clientY - rect.top)  / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, this._camera)
    const hits = raycaster.intersectObjects(
      this._loadedScene ? [this._loadedScene] : [], true
    )
    // Skip LineSegments (our edge overlays) — only pick Mesh objects.
    return hits.find(h => h.object.isMesh) || null
  }

  // ── Scene setup ─────────────────────────────────────────────────────────────

  _setupScene() {
    const el = this.element

    this._renderer = new THREE.WebGLRenderer({ antialias: true })
    this._renderer.setPixelRatio(window.devicePixelRatio)
    this._renderer.setSize(el.clientWidth, el.clientHeight)
    this._renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(this._renderer.domElement)

    this._scene = new THREE.Scene()
    this._scene.background = new THREE.Color(this._bgColor())

    this._camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.01, 10000)
    this._camera.position.set(0, 0, 5)

    this._scene.add(new THREE.AmbientLight(0xffffff, 1.0))

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0)
    dirLight1.position.set(0.5, 0.8, 1)
    this._camera.add(dirLight1)

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 1.0)
    dirLight2.position.set(-0.5, -0.3, 1)
    this._camera.add(dirLight2)

    this._scene.add(this._camera)

    this._controls = new OrbitControls(this._camera, this._renderer.domElement)
    this._controls.enableDamping = true
    this._controls.dampingFactor = 0.08

    this._renderer.setAnimationLoop((now) => {
      // Detect theme changes on every frame — cheap classList check, avoids
      // any MutationObserver timing/ordering issues with Stimulus + Turbo.
      const nowDark = document.documentElement.classList.contains('dark')
      if (nowDark !== this._isDark) {
        this._isDark = nowDark
        this._scene.background = new THREE.Color(this._bgColor())
        this._applyPartColors()
      }

      this._stepAnim(now)
      this._controls.update()
      this._renderer.render(this._scene, this._camera)
    })

    this._setupSelectionListeners()
  }

  // ── Smooth camera animation ─────────────────────────────────────────────────

  _stepAnim(now) {
    if (!this._anim) return
    const t = Math.min((now - this._anim.startTime) / ANIM_DURATION, 1)
    const e = 1 - Math.pow(1 - t, 3)  // cubic ease-out

    // Interpolate target first
    const tgt = new THREE.Vector3().lerpVectors(this._anim.fromTarget, this._anim.toTarget, e)
    this._controls.target.copy(tgt)

    // nlerp: keep camera at constant distance from target to prevent bulging.
    // Linear lerp traces a chord (gets closer mid-arc); nlerp stays on the sphere.
    const fromRel  = this._anim.fromPos.clone().sub(this._anim.fromTarget)
    const toRel    = this._anim.toPos.clone().sub(this._anim.toTarget)
    const fromDist = fromRel.length()
    const toDist   = toRel.length()
    const dist     = fromDist + (toDist - fromDist) * e

    const dir = fromRel.clone().normalize().lerp(toRel.clone().normalize(), e)
    if (dir.lengthSq() < 1e-10) dir.copy(toRel.clone().normalize())  // antiparallel fallback
    dir.normalize()

    this._camera.position.copy(tgt).addScaledVector(dir, dist)

    if (t >= 1) {
      this._camera.position.copy(this._anim.toPos)
      this._controls.target.copy(this._anim.toTarget)
      this._anim = null
    }
  }

  // ── Model loading ───────────────────────────────────────────────────────────

  _loadModel() {
    const loader = new GLTFLoader()
    loader.load(
      this.urlValue,
      (gltf) => {
        this._loadedScene = gltf.scene
        this._scene.add(gltf.scene)

        const box = new THREE.Box3().setFromObject(gltf.scene)
        box.getCenter(this._modelCenter)
        const size   = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const fov    = this._camera.fov * (Math.PI / 180)
        this._modelDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 0.75

        this._camera.position.copy(this._modelCenter)
        this._camera.position.z += this._modelDistance
        this._camera.near = this._modelDistance / 100
        this._camera.far  = this._modelDistance * 100
        this._camera.updateProjectionMatrix()

        this._controls.target.copy(this._modelCenter)
        this._controls.update()

        this._assignPartColors(gltf.scene)

        const tree = this._buildPartTree(this._loadedScene)
        document.dispatchEvent(new CustomEvent('model-viewer:parts-loaded', { detail: { tree } }))
      },
      undefined,
      (err) => console.error("GLTFLoader error:", err)
    )
  }

  // ── Part color assignment ───────────────────────────────────────────────────

  // Override every mesh's material color with its part's Tailwind palette,
  // and add an EdgesGeometry overlay so edges get their own palette variant.
  //
  // Palette assignment is keyed by the original material's color value so that:
  //   • faces sharing the same STEP color (same component) → same palette
  //   • faces with different STEP colors (different components) → different palettes
  // This works regardless of GLTF node naming and whether materials are shared
  // or cloned by the loader.
  _assignPartColors(scene) {
    this._partColorMap.clear()

    // Dispose any edge objects from a previous load
    for (const ls of this._edgeObjects) {
      ls.geometry.dispose()
      ls.material.dispose()
      ls.parent?.remove(ls)
    }
    this._edgeObjects = []

    // Map from quantised original color string → palette name, built as we
    // traverse so the first distinct color seen gets PALETTE_NAMES[0], the
    // second gets PALETTE_NAMES[1], cycling through all six.
    const colorKeyToPalette = new Map()
    let paletteIdx = 0

    // Collect mesh nodes first — do NOT mutate the scene graph during traverse,
    // because Three.js traverse holds a live reference to children[]. Adding a
    // LineSegments2 (which extends Mesh) during the walk causes it to be visited
    // and processed again, creating infinite recursion → stack overflow.
    const meshNodes = []
    scene.traverse((node) => {
      if (node.isMesh && node.geometry) meshNodes.push(node)
    })

    for (const node of meshNodes) {
      const origMat = Array.isArray(node.material) ? node.material[0] : node.material
      if (!origMat) continue

      // Quantise to 3 decimal places so floating-point noise doesn't split identical colors.
      const c   = origMat.color
      const key = `${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}`

      if (!colorKeyToPalette.has(key)) {
        colorKeyToPalette.set(key, PALETTE_NAMES[paletteIdx % PALETTE_NAMES.length])
        paletteIdx++
      }
      const palette = colorKeyToPalette.get(key)

      // Replace the GLTF-assigned material color with the palette surface color.
      // Clone first so we don't mutate shared materials.
      const surfMat = origMat.clone()
      node.material = surfMat
      this._partColorMap.set(node, { palette, isSurface: true, mat: surfMat })

      // Build an edge overlay using LineSegments2 so linewidth > 1px works.
      const threeEdgesGeo = new THREE.EdgesGeometry(node.geometry, 15)
      const edgesGeo = new LineSegmentsGeometry().fromEdgesGeometry(threeEdgesGeo)
      threeEdgesGeo.dispose()
      const edgesMat = new LineMaterial({ color: 0x000000, linewidth: EDGE_WIDTH })
      const edges    = new LineSegments2(edgesGeo, edgesMat)
      node.add(edges)
      this._edgeObjects.push(edges)
      this._partColorMap.set(edges, { palette, isSurface: false, mat: edgesMat })
    }

    this._applyPartColors()
    this._updateEdgeResolution()
  }

  // Push the correct palette variant to every tracked material based on the
  // current theme. Called on load and whenever the theme toggles.
  _applyPartColors() {
    for (const [, { palette, isSurface, mat }] of this._partColorMap) {
      const variant = isSurface ? (this._isDark ? 300 : 200) : (this._isDark ? 500 : 600)
      const color   = this._paletteColors[palette]?.[variant]
      if (color) mat.color.copy(color)
    }
  }

  // ── Theme-aware background ──────────────────────────────────────────────────

  _bgColor() {
    return this._isDark ? 0x22292b : 0x9ca8ab
  }

  // ── Resize ──────────────────────────────────────────────────────────────────

  _setupResizeObserver() {
    this._resizeObserver = new ResizeObserver(() => this._onResize())
    this._resizeObserver.observe(this.element)
  }

  _onResize() {
    const el = this.element
    this._camera.aspect = el.clientWidth / el.clientHeight
    this._camera.updateProjectionMatrix()
    this._renderer.setSize(el.clientWidth, el.clientHeight)
    this._updateEdgeResolution()
  }

  _updateEdgeResolution() {
    const el = this.element
    for (const edges of this._edgeObjects) {
      edges.material.resolution.set(el.clientWidth, el.clientHeight)
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  _cleanup() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
      this._resizeObserver = null
    }
    if (this._onPartTreeSelect) {
      document.removeEventListener('part-tree:select',            this._onPartTreeSelect)
      document.removeEventListener('part-tree:toggle-visibility', this._onPartTreeToggleVisibility)
      this._onPartTreeSelect = null
      this._onPartTreeToggleVisibility = null
    }
    if (this._renderer) {
      const canvas = this._renderer.domElement
      canvas.removeEventListener('mousedown', this._onMouseDown)
      canvas.removeEventListener('click',     this._onCanvasClick)
      this._renderer.setAnimationLoop(null)
      this._renderer.dispose()
      canvas.remove()
      this._renderer = null
    }
    for (const ls of this._edgeObjects) {
      ls.geometry.dispose()
      ls.material.dispose()
    }
    this._edgeObjects  = []
    this._partColorMap = new Map()
    this._paletteColors = null

    this._scene       = null
    this._camera      = null
    this._controls    = null
    this._anim        = null
    this._selection   = null
    this._loadedScene = null
  }
}
