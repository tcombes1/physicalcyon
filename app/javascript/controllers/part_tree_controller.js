import { Controller } from "@hotwired/stimulus"

const CHEVRON_SVG = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 150ms"><path d="M5 3l5 5-5 5"/></svg>`

const EYE_OPEN_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8s2.5-5 6.5-5 6.5 5 6.5 5-2.5 5-6.5 5-6.5-5-6.5-5z"/><circle cx="8" cy="8" r="2"/></svg>`

const EYE_OFF_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l12 12"/><path d="M6.8 6.9a2 2 0 002.3 2.3"/><path d="M4 4.4C2.6 5.5 1.5 7.3 1.5 8c0 0 2.5 5 6.5 5 1.3 0 2.5-.5 3.4-1.1"/><path d="M7.2 3.1C7.5 3 7.8 3 8 3c4 0 6.5 5 6.5 5-.4.8-1 1.7-1.8 2.5"/></svg>`

export default class extends Controller {
  static targets = ["placeholder"]

  connect() {
    this._onPartsLoaded = (e) => this._build(e.detail.tree)
    this._onPartSelected = (e) => this._updateActiveItem(e.detail.name)

    document.addEventListener('model-viewer:parts-loaded', this._onPartsLoaded)
    document.addEventListener('model-viewer:part-selected', this._onPartSelected)
  }

  disconnect() {
    document.removeEventListener('model-viewer:parts-loaded', this._onPartsLoaded)
    document.removeEventListener('model-viewer:part-selected', this._onPartSelected)
  }

  _build(tree) {
    for (const ul of this.element.querySelectorAll(':scope > ul')) ul.remove()
    if (this.hasPlaceholderTarget) this.placeholderTarget.remove()
    this.element.appendChild(this._renderNodes(tree, 0))
  }

  _renderNodes(nodes, depth) {
    const ul = document.createElement('ul')
    for (const node of nodes) ul.appendChild(this._renderNode(node, depth))
    return ul
  }

  _renderNode(node, depth) {
    const li = document.createElement('li')
    const hasChildren = node.children.length > 0

    // Row — `group` drives group-hover on the eye button
    // Active-state classes toggled by _updateActiveItem:
    //   bg-taupe-200 dark:bg-taupe-800  (on row)
    //   text-taupe-900 dark:text-taupe-100 (on nameBtn)
    const row = document.createElement('div')
    row.className = 'part-tree-row group flex items-center rounded transition-colors hover:bg-taupe-200 dark:hover:bg-taupe-800'
    row.style.paddingLeft = `${4 + depth * 12}px`
    row.dataset.partName = node.name

    // Chevron — fixed 16px width keeps names aligned at every depth
    const chevronBtn = document.createElement('button')
    chevronBtn.type = 'button'
    chevronBtn.className = 'flex-shrink-0 flex items-center justify-center opacity-40 hover:opacity-80 transition-opacity'
    chevronBtn.style.cssText = 'width:16px; height:22px'
    if (hasChildren) {
      chevronBtn.innerHTML = CHEVRON_SVG
    } else {
      chevronBtn.disabled = true
      chevronBtn.style.pointerEvents = 'none'
    }

    // Name — muted/disabled-looking by default
    const nameBtn = document.createElement('button')
    nameBtn.type = 'button'
    nameBtn.className = 'part-tree-item flex-1 text-left py-1 pr-1 text-xs truncate transition-colors text-taupe-600 dark:text-taupe-400'
    nameBtn.dataset.partName = node.name
    nameBtn.textContent = node.name

    // Eye — starts hidden (opacity-0), shown on group-hover
    const eyeBtn = document.createElement('button')
    eyeBtn.type = 'button'
    eyeBtn.className = 'part-tree-eye flex-shrink-0 flex items-center justify-center mr-1 transition-opacity text-taupe-500 dark:text-taupe-400'
    eyeBtn.style.cssText = 'width:20px; height:22px'
    eyeBtn._visible = true
    this._applyEyeClasses(eyeBtn, true, false)

    row.appendChild(chevronBtn)
    row.appendChild(nameBtn)
    row.appendChild(eyeBtn)
    li.appendChild(row)

    // Children
    let childUl = null
    if (hasChildren) {
      childUl = this._renderNodes(node.children, depth + 1)
      const autoExpand = depth === 0
      childUl.style.display = autoExpand ? 'block' : 'none'
      const svg = chevronBtn.querySelector('svg')
      if (svg && autoExpand) svg.style.transform = 'rotate(90deg)'
      li.appendChild(childUl)

      chevronBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const open = childUl.style.display !== 'none'
        childUl.style.display = open ? 'none' : 'block'
        if (svg) svg.style.transform = open ? '' : 'rotate(90deg)'
      })
    }

    nameBtn.addEventListener('click', () => this._selectPart(node.name))

    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      eyeBtn._visible = !eyeBtn._visible
      this._applyEyeClasses(eyeBtn, eyeBtn._visible, false)
      // Propagate visual hidden state down to all descendants
      if (childUl) this._propagateHiddenState(childUl, eyeBtn._visible)
      document.dispatchEvent(new CustomEvent('part-tree:toggle-visibility', {
        detail: { name: node.name, visible: eyeBtn._visible }
      }))
    })

    return li
  }

  // Set the eye button's icon and opacity based on this node's own visibility
  // and whether an ancestor has forced it hidden.
  _applyEyeClasses(eyeBtn, visible, forcedHidden) {
    const showAsHidden = !visible || forcedHidden
    eyeBtn.innerHTML = showAsHidden ? EYE_OFF_SVG : EYE_OPEN_SVG
    if (showAsHidden) {
      eyeBtn.classList.remove('opacity-0', 'group-hover:opacity-50')
      eyeBtn.classList.add('opacity-60')
    } else {
      eyeBtn.classList.remove('opacity-60')
      eyeBtn.classList.add('opacity-0', 'group-hover:opacity-50')
    }
  }

  // Walk all descendant rows and update their eye display.
  // parentVisible=false means an ancestor was just hidden → force show eye-off.
  // parentVisible=true  means an ancestor was just shown  → restore own state.
  _propagateHiddenState(subtreeRoot, parentVisible) {
    for (const row of subtreeRoot.querySelectorAll('.part-tree-row')) {
      const eyeBtn = row.querySelector('.part-tree-eye')
      if (!eyeBtn) continue
      this._applyEyeClasses(eyeBtn, eyeBtn._visible, !parentVisible)
    }
  }

  _selectPart(name) {
    this._updateActiveItem(name)
    document.dispatchEvent(new CustomEvent('part-tree:select', { detail: { name } }))
  }

  _updateActiveItem(name) {
    for (const row of this.element.querySelectorAll('.part-tree-row')) {
      const active = row.dataset.partName === name
      row.classList.toggle('bg-taupe-200',      active)
      row.classList.toggle('dark:bg-taupe-800',  active)
      const nameBtn = row.querySelector('.part-tree-item')
      if (nameBtn) {
        nameBtn.classList.toggle('text-taupe-900',      active)
        nameBtn.classList.toggle('dark:text-taupe-100', active)
      }
    }
  }
}
