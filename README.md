# PuntroSales HTTP Proxy

Proxy HTTP simple para servir catálogos públicos de PuntroSales con URL corta, cache en memoria, logs de visitas y protección básica antiabuso.

La app recibe tráfico desde NGINX en la VM y NGINX hace reverse proxy hacia `localhost:8081`.

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

Para producción, configura Firebase Admin para leer Cloud Firestore:

```bash
FIRESTORE_CATALOG_COLLECTION=catalog_public_routes
FIRESTORE_DATABASE_ID=puntrosales
CATALOG_METADATA_TTL_SECONDS=60
FIREBASE_PROJECT_ID=logistics-355318
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@logistics-355318.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
INTERNAL_API_TOKEN=un-token-privado
```

También puedes usar una sola variable:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

O el mismo JSON en base64:

```bash
FIREBASE_SERVICE_ACCOUNT_BASE64=base64-encoded-service-account-json
```

O credenciales por archivo:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

## Correr local

Modo desarrollo con reload por cambios:

```bash
npm run dev
```

Modo producción local:

```bash
npm start
```

El puerto se configura con `PORT`. Si no existe, usa `8080`. En producción con NGINX se usa `8081`.

```bash
PORT=8081 npm start
```

## Endpoints

### Health

```bash
curl http://localhost:8081/health
```

Respuesta:

```text
OK
```

### Catálogo público

```bash
curl http://localhost:8081/c/demo-puntrosales-001
```

Ver headers de cache:

```bash
curl -I http://localhost:8081/c/demo-puntrosales-001
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
curl http://localhost:8081/stats/demo-puntrosales-001
```

Ejemplo:

```json
{
  "publicKey": "demo-puntrosales-001",
  "visits": 1
}
```

El contador se reinicia cuando se reinicia el proceso.

### Invalidar cache

Después de que Android actualice o desactive un catálogo, puedes limpiar cache inmediatamente:

```bash
curl -X POST http://localhost:8081/internal/cache/invalidate/demo-puntrosales-001 \
  -H "X-Internal-Token: un-token-privado"
```

Respuesta:

```json
{
  "publicKey": "demo-puntrosales-001",
  "invalidated": true
}
```

Si no llamas este endpoint, el proxy descubrirá cambios automáticamente después de `CATALOG_METADATA_TTL_SECONDS`.

## Configurar catálogos

En producción, los catálogos viven en Cloud Firestore. El proxy lee documentos desde:

```text
catalog_public_routes/{publicKey}
```

Ejemplo:

```text
catalog_public_routes/demo-puntrosales-001
```

Documento esperado:

```json
{
  "publicKey": "demo-puntrosales-001",
  "firebaseUrl": "https://firebasestorage.googleapis.com/v0/b/...",
  "enabled": true,
  "cacheTtlSeconds": 300,
  "ownerApp": "puntrosales-android",
  "catalogType": "restaurant-menu",
  "updatedAt": "2026-06-03T00:00:00.000Z",
  "disabledAt": null
}
```

Campos usados por el proxy:

- `publicKey`: slug público usado en `/c/:publicKey`.
- `firebaseUrl`: URL real de Firebase Storage. No se expone en la respuesta.
- `enabled`: permite apagar un catálogo sin borrar la configuración.
- `cacheTtlSeconds`: TTL de cache en memoria para ese catálogo.

`catalogs.json` queda como fallback local si Firebase Admin no está configurado.

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

Para dar de baja un catálogo desde Android, cambia:

```json
{
  "enabled": false
}
```

El proxy responderá:

```json
{
  "error": "Catalog disabled"
}
```

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
    server_name www.imecatro.com;

    location /catalog-api/ {
        proxy_pass http://127.0.0.1:8081/;
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
sudo certbot --nginx -d www.imecatro.com
```

## Uso final

URL que consumirá el frontend:

```text
https://www.imecatro.com/catalog/?url=BASE64_URL_SAFE(https://www.imecatro.com/catalog-api/c/demo-puntrosales-001)
```

Con la configuración NGINX `location /catalog-api/` y `proxy_pass http://127.0.0.1:8081/`, NGINX remueve el prefijo `/catalog-api/` antes de enviar la petición a Node.

Por eso:

```text
https://www.imecatro.com/catalog-api/c/demo-puntrosales-001
```

llega a la app Node como:

```text
GET /c/demo-puntrosales-001
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
