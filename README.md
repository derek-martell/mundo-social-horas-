# Mundo Social · Registro de horas

Página para que los miembros de Mundo Social registren sus horas de trabajo y para que los
coordinadores las aprueben y vean los totales.

- **Frontend:** HTML/CSS/JS estático, sin build (`index.html`, `styles.css`, `app.js`, `config.js`). Se publica en GitHub Pages.
- **Backend y datos:** un Google Sheet privado con un Google Apps Script publicado como Web App (`apps-script/Code.gs`).
- **Las horas nunca se guardan en este repositorio.** Viven solo en el Sheet, y el Web App solo devuelve datos a quien envía un código de acceso válido.

## Cómo funciona

| Rol | Qué puede hacer |
|---|---|
| `miembro` | Registrar sus horas, ver "Mis horas", eliminar sus registros no aprobados y ver sus propios totales. |
| `coordinador` | Lo mismo, más **aprobar o rechazar las horas de los equipos que coordina** y ver los totales de esos equipos. No puede aprobar sus propias horas. |
| `admin` | Ve y aprueba las horas de todo el grupo (incluidas las de los coordinadores) y ve todos los totales. |

Cada registro lleva: miembro, fecha, horas (en múltiplos de 15 minutos), área o proyecto, descripción, enlace opcional y estado (`pendiente`, `aprobado` o `rechazado`). Al rechazar, el revisor indica un motivo, que el miembro ve en "Mis horas".

La pestaña **Totales** muestra las horas por persona y mes, por área o proyecto y por equipo. Se puede filtrar por rango de meses o ver solo las horas aprobadas, y exportar a CSV.

## Puesta en marcha

### 1. Crear el Google Sheet

1. Crea un Google Sheet nuevo en la cuenta de Mundo Social (por ejemplo, *"Mundo Social – Registro de horas"*). **No lo compartas públicamente.** Solo deberían tener acceso los administradores.
2. En el Sheet, abre **Extensiones → Apps Script**.

### 2. Pegar el código

1. En el editor de Apps Script, reemplaza el contenido de `Código.gs` por el de [`apps-script/Code.gs`](apps-script/Code.gs).
2. (Opcional) En **Configuración del proyecto ⚙️**, marca *"Mostrar el archivo de manifiesto appsscript.json"* y pega el contenido de [`apps-script/appsscript.json`](apps-script/appsscript.json). Así quedan fijados la zona horaria (Lima) y el runtime V8.
3. Guarda el proyecto.
4. En la barra superior, elige la función **`configurar`** y pulsa **Ejecutar**. La primera vez Google pedirá autorizar el acceso al Sheet: acéptalo.
   Esto crea tres hojas:
   - **Miembros:** `id | nombre | email | equipo | rol | coordina | codigo | activo`, con tres filas de ejemplo.
   - **Registros:** aquí se guardan las horas. No hace falta tocarla.
   - **Areas:** la lista de áreas o proyectos que aparece en el formulario.
5. Recarga el Sheet. Aparece el menú **Registro de horas** con las opciones *Configurar hojas* y *Generar códigos faltantes*.

### 3. Cargar a los miembros

En la hoja **Miembros**, borra las filas de ejemplo y agrega una fila por persona:

| Columna | Qué poner |
|---|---|
| `id` | Un identificador único que no cambie, p. ej. `m01`, `m02`… |
| `nombre` | Nombre que se mostrará. |
| `email` | Opcional, como referencia. |
| `equipo` | El equipo al que pertenece (p. ej. `Redacción`, `Redes`, `Web`). **Su coordinador aprobará sus horas.** |
| `rol` | `miembro`, `coordinador` o `admin`. |
| `coordina` | Solo para coordinadores: los equipos que coordinan, separados por comas (p. ej. `Redacción, Edición`). Deben escribirse igual que en la columna `equipo` (no importan las mayúsculas). |
| `codigo` | Déjalo vacío y usa **Registro de horas → Generar códigos faltantes**: crea un código aleatorio de 10 caracteres para cada persona. |
| `activo` | `sí` para permitir el acceso. Pon `no` para quitárselo sin borrar sus horas. |

Envía a cada persona su código por un canal privado (WhatsApp, correo). Si un código se filtra, borra esa celda y vuelve a generar uno.

Edita la hoja **Areas** para dejar la lista de áreas o proyectos que usan.

> Si alguien cambia de equipo, sus registros anteriores se quedan con el equipo que tenía al registrarlos, y los aprueba el coordinador de ese equipo o el admin.

### 4. Desplegar el Web App

1. En Apps Script: **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**.
3. **Ejecutar como:** *Yo* (la cuenta dueña del Sheet).
4. **Quién tiene acceso:** *Cualquier persona*. Es necesario para que la página pueda llamarlo sin que cada miembro inicie sesión con Google. La protección la dan los códigos de acceso: sin un código válido, el Web App no devuelve ningún dato.
5. Pulsa **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).

> **Cada vez que cambies `Code.gs`**, ve a **Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar**. Así la URL se mantiene igual. Si creas una implementación nueva, la URL cambia.

### 5. Configurar la URL en el frontend

Edita [`config.js`](config.js) y pega la URL:

```js
window.MS_HORAS_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
};
```

La URL no es secreta (sin un código no devuelve datos), así que se puede subir al repo.

### 6. Publicar en GitHub Pages

1. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
2. La página quedará en `https://derek-martell.github.io/mundo-social-horas-/`.

> GitHub Pages en un repo **privado** requiere un plan de pago (GitHub Pro o Team). Con una cuenta gratuita hay dos opciones: hacer público el repo (no contiene datos de horas ni códigos, solo el código de la página) o copiar estos archivos a una carpeta del sitio principal (`derek-martell/mundo-social`), p. ej. `/horas/`.

Para probar en tu computadora basta con abrir `index.html` en el navegador, o servir la carpeta con `python3 -m http.server`.

## Seguridad y privacidad

- Los datos están solo en el Sheet. El repo no contiene horas, nombres de miembros ni códigos.
- Cada petición al Web App lleva el código del miembro, y los permisos (quién ve qué y quién aprueba qué) se validan **en el Apps Script**, no en el navegador.
- Tras 20 intentos fallidos de código en 10 minutos, el Web App bloquea los ingresos durante unos minutos. El bloqueo es para todo el Web App, no por persona.
- El código se guarda en `sessionStorage`: se borra al cerrar la pestaña. En computadoras compartidas, usa **Salir**.
- Si un texto empieza con `=`, `+`, `-` o `@`, se guarda como texto, para que nadie pueda inyectar fórmulas en el Sheet.
- La página tiene `noindex` para que los buscadores no la indexen.

## Estructura

```
index.html              Página única: ingreso, registro, mis horas, por aprobar, totales
styles.css              Estilos (con modo oscuro automático)
app.js                  Lógica del frontend
config.js               URL del Web App
apps-script/Code.gs     Backend (pegar en el editor de Apps Script)
apps-script/appsscript.json  Manifiesto opcional (zona horaria y runtime)
```

## Ideas para siguientes versiones

- Editar un registro pendiente (hoy se elimina y se vuelve a crear).
- Aviso por correo al coordinador cuando hay horas pendientes (con un activador semanal de Apps Script).
- Guardar los códigos como hash en el Sheet en lugar de en texto plano.
