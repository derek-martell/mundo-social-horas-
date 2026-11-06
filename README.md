# Mundo Social · Registro de horas

Calendario de trabajo para que los miembros de Mundo Social registren a qué horas trabajaron y en qué,
y para que los coordinadores lo aprueben y vean los totales. Funciona como una agenda: arrastras sobre
la semana para marcar el horario, escribes en qué trabajaste y listo.

**Demostración:** mientras `config.js` no tenga la URL del Web App, la página abre en *modo demostración*,
con datos de ejemplo y botones para entrar como miembro, coordinador o admin. Nada se guarda en ese modo.
Cuando la URL ya esté configurada, puedes volver a ver la demo agregando `?demo=1` a la dirección.

- **Frontend:** HTML/CSS/JS estático, sin build (`index.html`, `styles.css`, `app.js`, `config.js`, `demo.js`). Se publica en GitHub Pages.
- **Backend y datos:** un Google Sheet privado con un Google Apps Script publicado como Web App (`apps-script/Code.gs`).
- **Las horas nunca se guardan en este repositorio.** Viven solo en el Sheet, y el Web App solo devuelve datos a quien envía un código de acceso válido.

## Cómo funciona

| Rol | Qué puede hacer |
|---|---|
| `miembro` | Registrar sus horas, ver "Mis horas", eliminar sus registros no aprobados y ver sus propios totales. |
| `coordinador` | Lo mismo, más **aprobar o rechazar las horas de los equipos que coordina** y ver los totales de esos equipos. No puede aprobar sus propias horas. |
| `admin` | Ve y aprueba las horas de todo el grupo (incluidas las de los coordinadores) y ve todos los totales. |

Cada registro lleva: miembro, fecha, **hora de inicio y de fin** (en tramos de 15 minutos; las horas se calculan solas), área o proyecto, descripción, enlace opcional y estado (`pendiente`, `aprobado` o `rechazado`). No se permiten dos registros propios que se crucen en horario.

### El calendario

- **Vistas Día, Semana y Mes**, con mini calendario, total de horas por día y línea de la hora actual.
- **Registrar:** arrastra sobre la cuadrícula (o haz clic) y completa la ventanita: en qué trabajaste, horario, área y enlace. También con el botón *Registrar horas* o la tecla `C`.
- **Corregir:** arrastra un bloque para cambiarlo de hora o de día, estira su borde inferior para cambiar la duración, o haz clic para editarlo o eliminarlo. Las horas aprobadas ya no se pueden cambiar.
- **Colores:** cada área tiene su color. Un bloque sólido está aprobado, uno claro con borde está pendiente y uno rayado y tachado fue rechazado (al hacer clic se ve el motivo; si lo corriges, vuelve a pendiente).
- **Filtros** por estado y por área en el panel lateral, con el total del periodo visible.
- **Atajos:** `C` registrar, `T` hoy, `D`/`S`/`M` día, semana o mes, `J`/`K` avanzar o retroceder, `Esc` cerrar.

### Para coordinadores y admin

- **Calendario de…:** en el panel lateral eliges a un miembro de tu equipo y ves su semana tal cual la registró. Al hacer clic en un bloque puedes aprobarlo o rechazarlo, o aprobar de una vez todo lo pendiente del periodo.
- **Por aprobar:** lista de registros filtrable por estado, miembro y mes, con aprobación en lote. Al rechazar se pide el motivo.
- **Totales:** horas por persona y mes, por área o proyecto y por equipo, con filtro por rango de meses o solo aprobadas, y exportación a CSV.

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
   - **Registros:** aquí se guardan las horas (`… | inicio | fin` al final). No hace falta tocarla.
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

1. Haz público el repositorio: **Settings → General → Danger Zone → Change visibility → Public**. Es seguro: el repo solo tiene el código de la página, sin horas, nombres ni códigos de acceso.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`, y **Save**.
3. En uno o dos minutos la página queda en `https://derek-martell.github.io/mundo-social-horas-/`. Mientras no configures `config.js`, se verá el modo demostración.

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
index.html              Página única: ingreso, calendario, por aprobar, totales
styles.css              Estilos (con modo oscuro automático)
app.js                  Lógica del calendario y de las demás vistas
demo.js                 Backend simulado con datos de ejemplo (modo demostración)
config.js               URL del Web App
apps-script/Code.gs     Backend (pegar en el editor de Apps Script)
apps-script/appsscript.json  Manifiesto opcional (zona horaria y runtime)
```

## Ideas para siguientes versiones

- Registros que se repiten (p. ej. la reunión semanal) con un solo clic.
- Aviso por correo al coordinador cuando hay horas pendientes (con un activador semanal de Apps Script).
- Guardar los códigos como hash en el Sheet en lugar de en texto plano.
