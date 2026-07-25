import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as Cesium from 'cesium'
import App from './App.vue'
import './styles/main.css'

// 设置 Cesium Ion token（使用默认 token 或空）
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc5YzciLCJpZCI6NTc3MzMsImlhdCI6MTYyNzg0NTE4Mn0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
