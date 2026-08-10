# TAXOTE

## TAXOTE Driver para Android

La aplicación nativa está en `D:\Taxote\android-driver` y el APK instalable se genera en:

`D:\Taxote\downloads\TAXOTE-Driver.apk`

- `COMPILAR-TAXOTE-DRIVER.bat`: vuelve a compilar el APK.
- `INSTALAR-TAXOTE-DRIVER-USB.bat`: crea el puente USB, instala y abre la aplicación.
- El teléfono debe tener activada la depuración USB y debe aceptar la autorización de esta computadora.
- Mientras se use el servidor local, el puente USB conecta la app con `http://127.0.0.1:4173`.
- La versión 1.3 incorpora mapa principal a pantalla completa, zoom con dos dedos, carrito pequeño de tamaño fijo, puntos A/B/C, aceptación y cancelación controlada, chat público/privado, GPS en segundo plano y estados naranja, rojo o gris en la Central.

## Cómo iniciar la página

Haz doble clic en `INICIAR-TAXOTE.bat`. Se abrirá el servidor local y después la página en:

`http://127.0.0.1:4173`

La aplicación para pasajeros TAXOTE User está en:

`http://127.0.0.1:4173/user.html`

Mantén abierta la ventana **TAXOTE - Servidor** mientras utilizas la página. El mapa, la búsqueda de direcciones y el cálculo de rutas necesitan conexión a Internet.

No abras `index.html` directamente: en ese modo el navegador no puede acceder al buscador de direcciones.

## Configurar direcciones de Google Maps

1. En Google Cloud habilita **Places API (New)** y **Geocoding API** en un proyecto con facturación configurada.
2. Crea una clave de API y restríngela a esas dos API.
3. Haz doble clic en `CONFIGURAR-GOOGLE-MAPS.bat` y pega la clave cuando la ventana la solicite.
4. Cierra el servidor de TAXOTE y vuelve a ejecutar `INICIAR-TAXOTE.bat`.

La clave queda guardada localmente en `.env`, archivo excluido de Git. No compartas la clave por chat ni la escribas dentro de `app.js` o `index.html`.

## Funciones actuales

- Autocompletado de Google Maps mientras escribes, limitado a República Dominicana y con un máximo de seis sugerencias.
- Selección de recogida azul oscuro y destino rojo directamente sobre el mapa, mostrando siempre una dirección escrita.
- Panel de conductores movible entre el lado izquierdo y derecho en pantallas grandes; en pantallas pequeñas se acomoda debajo automáticamente.
- Ruta por carretera con distancia y tiempo estimado.
- TAXOTE User con inicio de sesión, creación de cuenta y entrada como invitado mediante teléfonos 809, 829 y 849.
- Historial reutilizable de direcciones para usuarios registrados e invitados.
- Confirmación A → B con distancia, tiempo y precio estimado antes de solicitar el servicio.
- Servicios pendientes visibles en la columna izquierda y cancelación con motivo y comentario opcional.
- Cancelación permitida en pendiente, aceptado, conductor en camino y conductor llegó; queda bloqueada desde que TAXOTE Driver inicia el viaje hasta que lo termina.
- Usuarios, direcciones, sesiones, viajes, precios y cancelaciones guardados en `.data/taxote.sqlite`.
- Caja de clientes de la central conectada con las cuentas registradas de TAXOTE User.
- Tabla de seguimiento conectada con TAXOTE User y filtros combinables por código, estado, pasajero, teléfono, conductor, recogida, destino y fecha.
- Los servicios cancelados o terminados se ocultan de Viajes activos y pasan a la página independiente `history.html`, accesible desde el menú lateral.
- La lista de conductores centra el mapa al pulsar un conductor y actualiza cada tres segundos el tiempo estimado para llegar al punto A.
- La campana administrativa reúne registros pendientes y cancelaciones; las cuentas sin revisar generan un nuevo recordatorio cada hora.
- `drivers-chat.html` ofrece chat público de la flota y conversaciones privadas, ordenadas por actividad y con indicadores de mensajes no leídos.

## Configurar la tarifa

La tarifa predeterminada se calcula en pesos dominicanos con una base de RD$150, RD$32 por kilómetro, RD$4 por minuto y un mínimo de RD$250. Puedes cambiarla añadiendo estas variables a `.env` y reiniciando TAXOTE:

```text
TAXOTE_FARE_BASE_DOP=150
TAXOTE_FARE_PER_KM_DOP=32
TAXOTE_FARE_PER_MINUTE_DOP=4
TAXOTE_FARE_MINIMUM_DOP=250
```

## Integración de TAXOTE Driver

La Central recibe únicamente conductores reales registrados y aprobados. Su ubicación se actualiza desde el servicio GPS de la APK: carrito naranja cuando está libre, rojo durante un servicio y gris cuando está desconectado, conservando la última posición conocida. El icono mantiene el mismo tamaño aunque cambie el zoom.

El cálculo de rutas continúa utilizando el servidor definido mediante `TAXOTE_ROUTER_URL`. Antes de publicar TAXOTE para uso comercial, configura un servicio de rutas con disponibilidad y cuotas adecuadas.
