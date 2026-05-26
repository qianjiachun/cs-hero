import { createApp } from 'vue'
import App from './App.vue'
import EditorApp from './EditorApp.vue'
import './style.css'

const params = new URLSearchParams(window.location.search)
const isEditor = params.get('window') === 'editor'

createApp(isEditor ? EditorApp : App).mount('#app')
