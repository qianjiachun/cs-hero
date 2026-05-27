import { createApp } from 'vue'
import App from './App.vue'
import EditorApp from './EditorApp.vue'
import './style.css'

/** 阻止非表单区域的文本拖选（桌面应用体验） */
function installDesktopSelectionGuard(): void {
  const allowSelector = 'input, textarea, [contenteditable="true"], .selectable'

  document.addEventListener(
    'selectstart',
    (e) => {
      const target = e.target
      if (target instanceof Element && target.closest(allowSelector)) return
      e.preventDefault()
    },
    { capture: true }
  )

  document.addEventListener(
    'dragstart',
    (e) => {
      const target = e.target
      if (target instanceof Element && target.closest(allowSelector)) return
      if (target instanceof HTMLImageElement || target instanceof SVGElement) {
        e.preventDefault()
      }
    },
    { capture: true }
  )
}

installDesktopSelectionGuard()

const params = new URLSearchParams(window.location.search)
const isEditor = params.get('window') === 'editor'

createApp(isEditor ? EditorApp : App).mount('#app')
