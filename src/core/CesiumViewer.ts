import * as Cesium from 'cesium';

export class CesiumViewer {
  private viewer: Cesium.Viewer;

  constructor(container: string | HTMLElement, options?: Partial<Cesium.Viewer.ConstructorOptions>) {
    this.viewer = new Cesium.Viewer(container, {
      // 默认配置
      terrain: Cesium.Terrain.fromWorldTerrain(),
      baseLayerPicker: true,
      geocoder: false,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: true,
      infoBox: true,
      ...options,
    });
  }

  // 获取原始 viewer
  getViewer(): Cesium.Viewer {
    return this.viewer;
  }

  // 加载 3D Tiles
  async load3DTiles(url: string): Promise<Cesium.Cesium3DTileset | null> {
    try {
      const tileset = await Cesium.Cesium3DTileset.fromUrl(url);
      this.viewer.scene.primitives.add(tileset);
      // 飞到 tileset
      this.viewer.zoomTo(tileset);
      return tileset;
    } catch (error) {
      console.error('Failed to load 3D Tiles:', error);
      return null;
    }
  }

  // 飞行到指定位置
  flyTo(longitude: number, latitude: number, height: number, duration?: number): void {
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
      duration: duration ?? 3,
    });
  }

  // 设置点击事件
  setPickHandler(
    callback: (picked: Cesium.Cesium3DTileFeature | null, position: Cesium.Cartesian3) => void,
  ): void {
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction(
      (click: { position: Cesium.Cartesian2 }) => {
        const picked = this.viewer.scene.pick(click.position);
        const cartesian = this.viewer.scene.pickPosition(click.position);
        if (picked instanceof Cesium.Cesium3DTileFeature && cartesian) {
          callback(picked, cartesian);
        } else {
          callback(null, cartesian || Cesium.Cartesian3.ZERO);
        }
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    );
  }

  // 获取场景拾取的 Cartesian3
  pickPosition(screenPosition: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
    return this.viewer.scene.pickPosition(screenPosition);
  }

  // 销毁
  destroy(): void {
    this.viewer.destroy();
  }
}
