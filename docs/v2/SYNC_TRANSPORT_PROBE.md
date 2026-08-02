# Diagnóstico del transporte de sincronización

Esta etapa comprueba el canal de mensajes de TaleSpire antes de utilizarlo para sincronizar hojas. No lee, modifica ni transmite personajes.

## Qué mide

- Los clientes que tienen cargado un symbiote con el mismo `interop ID` y su modo informado por TaleSpire.
- La entrega dirigida de un mensaje a cada cliente detectado.
- Los caracteres enviados y los caracteres que declara haber recibido el destinatario.
- El tiempo de ida y vuelta hasta recibir la confirmación.
- Fallos de envío y confirmaciones que no llegan en ocho segundos.

El protocolo de diagnóstico usa los mensajes `toolset-sync-probe` y `toolset-sync-probe-ack`. Cada prueba tiene un identificador aleatorio y la confirmación sólo es aceptada si proviene del destinatario esperado.

## Prueba manual

1. Abrir la misma campaña y el mismo tablero en al menos dos clientes de TaleSpire con el symbiote actualizado.
2. En una hoja, abrir el menú `…` y luego `Diagnóstico de sincronización`.
3. Abrir el symbiote en ambos clientes. Pulsar `Actualizar clientes` y comprobar que aparezcan los demás clientes compatibles.
4. Probar, en este orden: 256, 384 y 480 caracteres. Probar el límite exacto de 500 caracteres al final.
5. Repetir desde el otro cliente para comprobar ambos sentidos.
6. Repetir después de que un cliente salga y vuelva a entrar, y con combinaciones jugador-jugador y jugador-GM.

Una prueba correcta debe indicar `Recibido`, el mismo tamaño enviado y recibido, y una latencia. Un fallo de envío se muestra como `Falló`; una entrega sin confirmación pasa a `Sin respuesta` luego de ocho segundos.

El descubrimiento utiliza `TS.sync.getClientsConnected()`, no la lista general del tablero. Un jugador puede estar en el mismo tablero y aun así no ser sincronizable si no tiene cargado este symbiote con el mismo `interop ID`.

## Resultado confirmado

TaleSpire rechaza cualquier string de más de 500 caracteres antes de enviarlo (`stringLengthError`). Por eso el protocolo utilizará mensajes de hasta 480 caracteres, dejando 20 caracteres de margen ante posibles diferencias de serialización. Los sobres reales serán ASCII y el contenido binario o Unicode viajará codificado, para que el tamaño del string sea predecible.

La prueba de 500 permite comprobar si el límite es inclusivo, pero no se utilizará como tamaño operativo.

Esta prueba valida descubrimiento, direccionamiento, integridad de tamaño y latencia básica. Todavía no demuestra orden, ausencia de duplicados ni comportamiento bajo ráfagas. Esas garantías se medirán en la siguiente etapa antes de transportar cambios reales.

## Siguiente etapa

Con los resultados se fijarán:

- tamaño máximo de cada fragmento;
- tiempo de espera y cantidad de reintentos;
- límite de mensajes simultáneos;
- formato de sobre, numeración y confirmaciones;
- detección de mensajes duplicados, perdidos o fuera de orden.

Después de validar ese transporte se implementará el registro de operaciones por personaje, no por jugador, para permitir que cualquier usuario modifique cualquier personaje y que cada historial pueda conciliarse de manera independiente.
