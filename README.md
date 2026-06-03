# PuntroSales HTTP Proxy

Proxy HTTP simple para servir catálogos públicos de PuntroSales con URL corta, cache en memoria, logs de visitas y protección básica antiabuso.

La app recibe tráfico desde NGINX en la VM y NGINX hace reverse proxy hacia `localhost:8080`.

## Requisitos

- Node.js 20+
- npm
- PM2 para producción

## Instalar

```bash
npm install
```

## Configurar entorno local

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Edita `.env` y reemplaza `DEMO_PUNTROSALES_FIREBASE_URL` con la URL real de Firebase Storage.

No subas `.env` a git. La URL de Firebase puede contener un `token` de acceso y debe quedarse fuera del repositorio publico.

## Correr local

Modo desarrollo con reload por cambios:

```bash
npm run dev
```

Modo producción local:

```bash
npm start
```

El puerto se configura con `PORT`. Si no existe, usa `8080`.

```bash
PORT=8080 npm start
```

## Endpoints

### Health

```bash
curl http://localhost:8080/health
```

Respuesta:

```text
OK
```

### Catálogo público

```bash
curl http://localhost:8080/c/demo-puntrosales-001
```

Ver headers de cache:

```bash
curl -I http://localhost:8080/c/demo-puntrosales-001
```

Headers esperados:

```text
X-PuntroSales-Cache: MISS
```

o:

```text
X-PuntroSales-Cache: HIT
```

### Stats en memoria

```bash
curl http://localhost:8080/stats/demo-puntrosales-001
```

Ejemplo:

```json
{
  "publicKey": "demo-puntrosales-001",
  "visits": 1
}
```

El contador se reinicia cuando se reinicia el proceso.

## Configurar catálogos

Los catálogos viven en `catalogs.json`.

```json
[
  {
    "publicKey": "demo-puntrosales-001",
    "firebaseUrl": "${DEMO_PUNTROSALES_FIREBASE_URL}",
    "enabled": true,
    "cacheTtlSeconds": 300
  }
]
```

Campos:

- `publicKey`: slug público usado en `/c/:publicKey`.
- `firebaseUrl`: URL real de Firebase Storage o placeholder de variable de entorno. No se expone en la respuesta.
- `enabled`: permite apagar un catálogo sin borrar la configuración.
- `cacheTtlSeconds`: TTL de cache en memoria para ese catálogo.

## CORS

Orígenes permitidos:

- `https://www.imecatro.com`
- `https://imecatro.com`
- `http://localhost:3000`
- `http://localhost:5173`

La app soporta `OPTIONS` para preflight.

## Rate limit

Límite básico por IP:

```text
60 requests por minuto
```

La IP se toma desde `X-Forwarded-For` cuando existe, porque la app corre detrás de OCI Load Balancer y NGINX.

## Logs

Cada visita al catálogo genera un log JSON:

```json
{
  "event": "catalog_visit",
  "publicKey": "demo-puntrosales-001",
  "ip": "203.0.113.10",
  "userAgent": "curl/8.0.0",
  "referer": null,
  "cache": "MISS",
  "createdAt": "2026-06-02T00:00:00.000Z"
}
```

No se imprime la URL real de Firebase en logs de visita.

## Despliegue en VM con PM2

```bash
git clone https://github.com/zayelmech/puntrosales-backend.git
cd puntrosales-backend
npm install --omit=dev
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Después de ejecutar `pm2 startup`, PM2 imprimirá un comando adicional con `sudo`. Copia y ejecuta ese comando en la VM.

Comandos útiles:

```bash
pm2 status
pm2 logs puntrosales-http-proxy
pm2 restart puntrosales-http-proxy
```

## NGINX sugerido

```nginx
server {
    listen 80;
    server_name apps.imecatro.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 10s;
        proxy_send_timeout 10s;
        proxy_read_timeout 10s;
    }
}
```

Si usas HTTPS con Certbot, deja que Certbot agregue el bloque TLS:

```bash
sudo certbot --nginx -d apps.imecatro.com
```

## Uso final

URL que consumirá el frontend:

```text
https://www.imecatro.com/json_web_catalog/?catalog=https://apps.imecatro.com/c/demo-puntrosales-001
```

## Preparación y build

No hay build obligatorio porque esta app usa JavaScript puro en Node.js 20+.

Preparación:

```bash
npm install
npm start
```

Para producción en VM:

```bash
npm install --omit=dev
npm start
```

## Docker opcional para después

No se incluye Docker en este MVP. Una versión futura podría agregar:

- `Dockerfile` basado en `node:20-alpine`.
- `docker-compose.yml` para correr el proxy con variables de entorno.
- Healthcheck contra `/health`.
- Volumen o config externa para `catalogs.json`.
