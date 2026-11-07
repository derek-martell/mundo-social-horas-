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

Cada persona pertenece a **un área** (Redacción, Redes sociales, Diseño…). Las horas se aprueban en cadena:

| Rol | Qué puede hacer | Quién aprueba sus horas |
|---|---|---|
| `miembro` | Registrar, corregir y ver sus propias horas y totales. | El coordinador de su área. |
| `coordinador` | Lo mismo, más **ver y aprobar solo a los miembros de su área**, y ver los totales de su área. | El admin. |
| `admin` | Aprobar las horas de **los coordinadores** y ver el **resumen general** de todo el grupo en Totales. | Nadie: se aprueban solas al registrarlas (y puede corregirlas). |

Nadie aprueba sus propias horas. Si un área no tiene coordinador activo, sus miembros los aprueba el admin, para que nadie quede sin revisar.

Cada registro lleva: miembro, área (la de la persona, se pone sola), fecha, **hora de inicio y de fin** (en tramos de 15 minutos; las horas se calculan solas), descripción, enlace opcional y estado (`pendiente`, `aprobado` o `rechazado`). No se permiten dos registros propios que se crucen en horario.

### El calendario

- **Vistas Día, Semana y Mes**, con mini calendario, total de horas por día y línea de la hora actual.
- **Registrar:** arrastra sobre la cuadrícula (o haz clic) y completa la ventanita: en qué trabajaste, horario y enlace. También con el botón *Registrar horas* o la tecla `C`.
- **Corregir:** arrastra un bloque para cambiarlo de hora o de día, estira su borde inferior para cambiar la duración, o haz clic para editarlo o eliminarlo. Las horas aprobadas ya no se pueden cambiar.
- **Colores:** cada área tiene su color. Un bloque sólido está aprobado, uno claro con borde está pendiente y uno rayado y tachado fue rechazado (al hacer clic se ve el motivo; si lo corriges, vuelve a pendiente).
- **Filtros** por estado en el panel lateral, con el total del periodo visible.
- **Atajos:** `C` registrar, `T` hoy, `D`/`S`/`M` día, semana o mes, `J`/`K` avanzar o retroceder, `Esc` cerrar.

### Para coordinadores y admin

- **Calendario de…:** en el panel lateral eliges a alguien que te toca aprobar (el coordinador, a los miembros de su área; el admin, a los coordinadores) y ves su semana tal cual la registró. Al hacer clic en un bloque puedes aprobarlo o rechazarlo, o aprobar de una vez todo lo pendiente del periodo.
- **Por aprobar:** lista de los registros que te toca revisar, filtrable por estado, persona y mes, con aprobación en lote. Al rechazar se pide el motivo.
- **Totales:** horas por persona y mes (con su **rol**) y por área. El admin ve todo el grupo; el coordinador, su área. Se puede filtrar por rango de meses, por rol (solo coordinadores, solo miembros…) o solo aprobadas.
- **Descargar Excel:** baja un `.xlsx` con los mismos filtros de la pantalla y tres hojas (*Por persona y mes*, *Por área* y *Detalle* con cada registro). Cada hoja ya trae los filtros puestos en los encabezados: haz clic en la flechita de una columna para filtrar por persona, rol, área, estado o fecha.

### Tareas y metas

- **Quién asigna a quién:** igual que en la aprobación de horas. El coordinador asigna tareas a los miembros de su área; el admin, a los coordinadores (y a quien esté en un área sin coordinador). El admin, además, puede ponerse tareas a sí mismo (opción **Yo** en *Para*).
- **Nueva tarea:** a quién, qué (y un detalle opcional), plazo (**esta semana**, **fin de mes** u otra fecha) y si es de prioridad alta.
- **Varias personas a la vez (solo admin):** en *Para* el admin marca varias personas, con atajos **Todos los directores**, **Todos** y **Ninguno**. Se crea una tarea por persona, para que cada una lleve su propio avance y sus horas.
- **Mis tareas:** cada persona ve sus tareas agrupadas en *Vencidas*, *Esta semana*, *Este mes*, *Más adelante* y *Terminadas*. Puede empezarlas, marcarlas como hechas, dejar una nota y **registrar horas ligadas a la tarea** (las horas dedicadas se suman solas).
- **Metas de esta semana:** en el panel lateral del calendario, con un clic para marcarlas como hechas. La pestaña *Tareas* muestra cuántas quedan.
- **Asignadas por mí:** el avance de cada persona (cuántas hechas, horas dedicadas, vencidas). Quien asignó la tarea puede editarla, cancelarla, reabrirla o eliminarla. El admin además ve **Todo el grupo**.
- En el Excel de Totales, la hoja *Detalle* incluye la tarea de cada registro.

### Planilla (directores y admin)

- Cada director de área (rol `coordinador`) ve en **Planilla** a las personas de las áreas que dirige. Puede **agregar** a quien entra, **editar** su nombre, correo o área, **desactivar** a quien se va (pierde el acceso, pero su historial de horas y tareas se conserva) y **reactivarlo** si vuelve.
- Al agregar a alguien, o con **Nuevo código**, la app muestra su código de acceso de 8 dígitos **una sola vez**, para que el director se lo envíe por privado.
- El director no puede cambiar roles ni tocar a otros directores. El admin gestiona a todos: crea directores, define qué áreas dirige cada uno y cambia roles.

### Actividad (supervisión de RRHH)

- Cada persona del área **Recursos Humanos** puede supervisar una o varias áreas (columna `supervisa` de Miembros). Se lo asignan las **directoras de RRHH** o el **admin**, desde **Planilla → Editar** (o **Asignar supervisión**).
- La pestaña **Actividad** muestra, por persona activa: última vez que registró horas, horas de los últimos 7 días y del mes, tareas abiertas y vencidas, y su estado:
  - **Inactivo** (rojo): 7 días o más sin registrar horas, o nunca registró.
  - **En riesgo** (amarillo): 4 a 6 días.
  - **Activo**.
- El supervisor ve solo sus áreas; el admin y las directoras de RRHH ven todas.
- **Notas de seguimiento:** quien supervisa el área (y el admin y las directoras de RRHH) puede anotar el seguimiento de cada persona. El director del área las lee desde su Planilla (botón **Seguimiento**).

## Puesta en marcha

### 1. Crear el Google Sheet

1. Crea un Google Sheet nuevo en la cuenta de Mundo Social (por ejemplo, *"Mundo Social – Registro de horas"*). **No lo compartas públicamente.** Solo deberían tener acceso los administradores.
2. En el Sheet, abre **Extensiones → Apps Script**.

### 2. Pegar el código

1. En el editor de Apps Script, reemplaza el contenido de `Código.gs` por el de [`apps-script/Code.gs`](apps-script/Code.gs).
2. (Opcional) En **Configuración del proyecto ⚙️**, marca *"Mostrar el archivo de manifiesto appsscript.json"* y pega el contenido de [`apps-script/appsscript.json`](apps-script/appsscript.json). Así quedan fijados la zona horaria (Lima) y el runtime V8.
3. Guarda el proyecto.
4. En la barra superior, comprueba que el selector de funciones diga **`configurar`** (es la primera del archivo) y pulsa **▶ Ejecutar**. En el **Registro de ejecución** verás "N código(s) generado(s)" y "Listo. Hojas: Miembros, Registros, Tareas". Para verificar el Web App ya desplegado, abre su URL en el navegador: muestra un diagnóstico (hojas y cuántas personas tienen código). La primera vez Google pedirá autorizar el acceso al Sheet: acéptalo.
   Esto crea cuatro hojas:
   - **Miembros:** `id | nombre | email | area | rol | coordina | codigo | activo | supervisa`, con tres filas de ejemplo.
   - **Registros:** aquí se guardan las horas. No hace falta tocarla.
   - **Tareas:** las tareas y metas asignadas. Tampoco hace falta tocarla.
   - **Seguimiento:** las notas de seguimiento de RRHH.
5. Recarga el Sheet. Aparece el menú **Registro de horas** con las opciones *Configurar hojas* y *Generar códigos faltantes*.

### 3. Cargar a los miembros

En la hoja **Miembros**, borra las filas de ejemplo y agrega una fila por persona:

| Columna | Qué poner |
|---|---|
| `id` | Un identificador único que no cambie, p. ej. `m01`, `m02`… |
| `nombre` | Nombre que se mostrará. |
| `email` | Opcional, como referencia. |
| `area` | El área a la que pertenece (p. ej. `Redacción`, `Redes sociales`, `Diseño`). Es obligatoria. La lista de áreas sale de esta columna. |
| `rol` | `miembro`, `coordinador` o `admin`. |
| `coordina` | Solo para coordinadores: el área que coordinan (o varias, separadas por comas). Se escribe igual que en la columna `area` (no importan las mayúsculas). Normalmente es su propia área. |
| `codigo` | Déjalo vacío y usa **Registro de horas → Generar códigos faltantes**: crea un código numérico de 8 dígitos, distinto para cada persona (p. ej. `48302917`). |
| `activo` | `sí` para permitir el acceso. Pon `no` para quitárselo sin borrar sus horas. |
| `supervisa` | Solo para personas de RRHH: las áreas cuya actividad supervisan, separadas por comas. Se puede dejar vacío y asignarlo desde la Planilla. |

Envía a cada persona su código por un canal privado (WhatsApp, correo). Si un código se filtra, borra esa celda y vuelve a generar uno.

> Si alguien cambia de área, sus registros anteriores se quedan con el área que tenía al registrarlos, y los revisa el coordinador de esa área.

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

### Al cambiar el código de la página

`index.html` carga los archivos con un número de versión (`app.js?v=…`). Si cambias `app.js`, `demo.js`, `styles.css` o `config.js`, sube ese número en las cuatro líneas de `index.html`: así los navegadores descargan la versión nueva en lugar de usar una guardada.

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
