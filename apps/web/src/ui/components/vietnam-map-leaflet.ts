'use client';

export interface MapPointMarker {
  lat: number;
  lng: number;
  label: string;
  subLabel?: string;
  kind: 'BRANCH' | 'CHECK_IN' | 'CHECK_OUT' | 'DEVICE';
  distanceM?: number | null;
  withinRadius?: boolean;
}

export interface VietnamMapRenderConfig {
  branchName?: string;
  branchAddress?: string;
  branchLat?: number | null;
  branchLng?: number | null;
  branchRadiusM?: number;
  points?: MapPointMarker[];
  tileMode?: 'GOOGLE_VN' | 'SATELLITE';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeafletAny = any;

let leafletLoadPromise: Promise<LeafletAny> | null = null;

export function loadLeafletLibrary(): Promise<LeafletAny> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  const w = window as unknown as { L?: LeafletAny };
  if (w.L) return Promise.resolve(w.L);
  if (leafletLoadPromise) return leafletLoadPromise;

  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('umbm-leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'umbm-leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js';
    script.async = true;
    script.onload = () => (w.L ? resolve(w.L) : reject(new Error('Leaflet load failed')));
    script.onerror = () => {
      leafletLoadPromise = null;
      reject(new Error('Không thể tải thư viện bản đồ'));
    };
    document.head.appendChild(script);
  });
  return leafletLoadPromise;
}

function createPinIcon(L: LeafletAny, bg: string, badgeText: string) {
  return L.divIcon({
    className: 'umbm-map-pin-icon',
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -36],
    html: `<div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 5px rgba(15,23,42,0.32));">
      <div style="background:${bg};color:#FFFFFF;border:2px solid #FFFFFF;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:700;white-space:nowrap;line-height:1.35;">${badgeText}</div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${bg};margin-top:-1px;"></div>
    </div>`,
  });
}

function createBaseTileLayer(L: LeafletAny, mode: 'GOOGLE_VN' | 'SATELLITE') {
  const lyrs = mode === 'SATELLITE' ? 'y' : 'm';
  return L.tileLayer(`https://{s}.google.com/vt/lyrs=${lyrs}&hl=vi&gl=VN&x={x}&y={y}&z={z}`, {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20,
    maxNativeZoom: 20,
    referrerPolicy: 'no-referrer',
    attribution: mode === 'SATELLITE' ? 'Ảnh Vệ tinh Việt Nam' : 'Bản đồ Chi tiết Việt Nam',
  });
}

function addCleanVietnamSeaLabels(L: LeafletAny, map: LeafletAny) {
  const seaMasks = [
    [[15.4, 110.8], [17.3, 113.1]],
    [[7.5, 111.5], [11.9, 117.2]],
  ];
  for (const bounds of seaMasks) {
    L.rectangle(bounds, { color: 'transparent', weight: 0, fillColor: '#AAD3DF', fillOpacity: 0.94, interactive: false }).addTo(map);
  }
  const seaLabels = [
    { lat: 16.5333, lng: 111.6167, text: 'Quần đảo Hoàng Sa (Đà Nẵng, Việt Nam)' },
    { lat: 9.6667, lng: 114.25, text: 'Quần đảo Trường Sa (Khánh Hòa, Việt Nam)' },
    { lat: 13.2, lng: 111.8, text: 'Biển Đông' },
  ];
  for (const item of seaLabels) {
    const icon = L.divIcon({
      className: 'umbm-sea-geo-label',
      iconSize: [220, 22],
      iconAnchor: [110, 11],
      html: `<div style="color:#1E3A8A;font-size:11.5px;font-weight:600;text-shadow:0 0 3px #FFFFFF,0 0 3px #FFFFFF;text-align:center;white-space:nowrap;">${item.text}</div>`,
    });
    L.marker([item.lat, item.lng], { icon, interactive: false }).addTo(map);
  }
}

export function renderVietnamGpsMap(
  L: LeafletAny,
  container: HTMLElement,
  config: VietnamMapRenderConfig,
): {
  map: LeafletAny;
  setTileMode: (mode: 'GOOGLE_VN' | 'SATELLITE') => void;
  fitMainBounds: () => void;
  flyToBranch: () => void;
  flyToPoint: (idx: number) => void;
} {
  const hasBranch = config.branchLat !== undefined && config.branchLat !== null && config.branchLng !== undefined && config.branchLng !== null && !Number.isNaN(Number(config.branchLat)) && !Number.isNaN(Number(config.branchLng));
  const bLat = hasBranch ? Number(config.branchLat) : null;
  const bLng = hasBranch ? Number(config.branchLng) : null;
  const radiusM = Math.max(10, Number(config.branchRadiusM || 100));
  const validPoints = (config.points ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const initCenter: [number, number] = bLat !== null && bLng !== null
    ? [bLat, bLng]
    : validPoints[0]
      ? [validPoints[0].lat, validPoints[0].lng]
      : [10.7769, 106.7009];

  const map = L.map(container, { center: initCenter, zoom: 17, zoomControl: true, attributionControl: true });
  let activeTileLayer = createBaseTileLayer(L, config.tileMode === 'SATELLITE' ? 'SATELLITE' : 'GOOGLE_VN').addTo(map);

  addCleanVietnamSeaLabels(L, map);

  const boundsCoords: [number, number][] = [];

  if (bLat !== null && bLng !== null) {
    boundsCoords.push([bLat, bLng]);
    const circle = L.circle([bLat, bLng], {
      radius: radiusM,
      color: '#2563EB',
      weight: 2,
      fillColor: '#3B82F6',
      fillOpacity: 0.14,
    }).addTo(map);
    const cBounds = circle.getBounds();
    if (cBounds?.isValid?.()) {
      boundsCoords.push([cBounds.getNorthEast().lat, cBounds.getNorthEast().lng]);
      boundsCoords.push([cBounds.getSouthWest().lat, cBounds.getSouthWest().lng]);
    }
    const branchMarker = L.marker([bLat, bLng], {
      icon: createPinIcon(L, '#2563EB', `Cửa hàng (${radiusM}m)`),
      zIndexOffset: 2000,
    }).addTo(map);
    branchMarker.bindPopup(
      `<div style="min-width:190px;">
        <div style="font-weight:700;color:#1E40AF;margin-bottom:2px;">${config.branchName || 'Vị trí Chi nhánh / Cửa hàng'}</div>
        ${config.branchAddress ? `<div style="font-size:12px;color:#475569;margin-bottom:4px;">${config.branchAddress}</div>` : ''}
        <div style="font-size:12px;">Tọa độ: <code>${bLat.toFixed(5)}, ${bLng.toFixed(5)}</code></div>
        <div style="font-size:12px;color:#2563EB;font-weight:600;">Bán kính cho phép: ${radiusM}m</div>
      </div>`,
    );
  }

  validPoints.forEach((pt) => {
    boundsCoords.push([pt.lat, pt.lng]);
    const isOut = pt.withinRadius === false || (pt.distanceM !== undefined && pt.distanceM !== null && pt.distanceM > radiusM);
    const color = pt.kind === 'CHECK_OUT' ? '#7C3AED' : isOut ? '#DC2626' : '#16A34A';
    const shortTag = pt.kind === 'CHECK_IN' ? 'Vị trí Vào ca' : pt.kind === 'CHECK_OUT' ? 'Vị trí Ra ca' : 'Vị trí Thiết bị';
    const distSuffix = pt.distanceM !== undefined && pt.distanceM !== null ? ` · ${Math.round(pt.distanceM)}m` : '';

    if (bLat !== null && bLng !== null) {
      L.polyline([[bLat, bLng], [pt.lat, pt.lng]], {
        color,
        weight: 2.5,
        dashArray: '6 6',
        opacity: 0.85,
      }).addTo(map);
    }

    const marker = L.marker([pt.lat, pt.lng], {
      icon: createPinIcon(L, color, `${shortTag}${distSuffix}`),
      zIndexOffset: 3000,
    }).addTo(map);
    marker.bindPopup(
      `<div style="min-width:190px;">
        <div style="font-weight:700;color:${color};margin-bottom:2px;">${pt.label}</div>
        ${pt.subLabel ? `<div style="font-size:12px;color:#475569;margin-bottom:4px;">${pt.subLabel}</div>` : ''}
        <div style="font-size:12px;">Tọa độ: <code>${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}</code></div>
        ${pt.distanceM !== undefined && pt.distanceM !== null ? `<div style="font-size:12px;font-weight:600;color:${color};">Khoảng cách tới cửa hàng: ${Math.round(pt.distanceM)}m / ${radiusM}m</div>` : ''}
      </div>`,
    );
  });

  const fitMainBounds = () => {
    if (boundsCoords.length > 1) {
      map.fitBounds(boundsCoords, { padding: [36, 36], maxZoom: 18 });
    } else if (boundsCoords.length === 1) {
      map.setView(boundsCoords[0]!, 17);
    }
  };
  fitMainBounds();

  return {
    map,
    setTileMode: (mode: 'GOOGLE_VN' | 'SATELLITE') => {
      if (activeTileLayer) map.removeLayer(activeTileLayer);
      activeTileLayer = createBaseTileLayer(L, mode).addTo(map);
      map.invalidateSize();
    },
    fitMainBounds,
    flyToBranch: () => { if (bLat !== null && bLng !== null) map.setView([bLat, bLng], 17); },
    flyToPoint: (idx: number) => { const p = validPoints[idx]; if (p) map.setView([p.lat, p.lng], 18); },
  };
}
