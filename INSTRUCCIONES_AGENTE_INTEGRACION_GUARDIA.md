# Instrucciones Para Agente - Integracion `/report/guardia`

## Objetivo
Implementar en otro frontend una pantalla de reporte de guardias consumiendo `GET /report/guardia` y recreando el esqueleto funcional de `GET /report/guardia/view`.

No uses `/report/guardia/view` como fuente de datos. Usa solo el JSON de `/report/guardia`.

## Endpoint base
- Canonico: `/report/guardia`
- Soporta tambien `/report/guardia/`

## Query params soportados
- `compania`: filtra una compania (ej: `1`, `general`).
- `estado_valido`: estado(s) que cuentan para `N Bomberos`.
- Alias para estados: `estados_validos`, `estado_bombero`.

`estado_valido` puede enviarse:
- Repetido: `?estado_valido=DISPONIBLE&estado_valido=GUARDIA%20NOCTURNA`
- Con comas: `?estado_valido=DISPONIBLE,GUARDIA%20NOCTURNA`

## Contrato de respuesta (estructura)
```json
{
  "captured_at": "ISO_DATE",
  "source_urls": {
    "cuarteles_ahora": "string",
    "siac_resumen": "string",
    "cuarteles_todo": "string"
  },
  "filtros_aplicados": {
    "compania": "string|null",
    "estados_validos": ["string"]
  },
  "estados_disponibles": ["string"],
  "tipos_unidades": ["B", "BX", "Q", "M", "QM", "GR", "H", "BH", "BR", "RX", "K", "S", "Z", "MX"],
  "metricas": {
    "total_bomberos_guardia": 0,
    "total_companias_servicio": 0,
    "total_conductores_servicio": 0,
    "resumen_unidades_servicio": {
      "B": 0
    }
  },
  "filas": [
    {
      "compania": "string",
      "compania_key": "string",
      "cuartel": "string|null",
      "estado": "0-8|0-9",
      "oficiales_disponibles": ["string"],
      "n_bomberos": 0,
      "total_especialistas": 0,
      "detalle_habilitaciones": {},
      "conductores": ["string"],
      "observaciones": "",
      "unidades": {
        "B": 0
      },
      "carros_en_servicio": [
        {
          "carro": "string",
          "conductor": "string",
          "estado": "string",
          "disponible": "string",
          "mecanica": "string"
        }
      ]
    }
  ]
}
```

## Esqueleto UI obligatorio (equivalente a `/report/guardia/view`)
1. Header:
- Titulo: `Reporte de Guardias`.
- Fecha/hora con `captured_at`.
- Fuente (puedes mostrar `source_urls.cuarteles_ahora`).

2. Tarjeta de metricas:
- `Cantidad total de bomberos de guardia` -> `metricas.total_bomberos_guardia`
- `Cantidad total de companias y brigadas en servicio` -> `metricas.total_companias_servicio`
- `Cantidad total de conductores en servicio` -> `metricas.total_conductores_servicio`
- Si existe: `Filtro compania` -> `filtros_aplicados.compania`
- `Estados validos para N Bomberos` -> `filtros_aplicados.estados_validos.join(", ")`

3. Selector de estados (dentro de la misma tarjeta de metricas):
- Control `select` multiple con `name=estado_valido`.
- Opciones base: `estados_disponibles`.
- Si algun estado de `filtros_aplicados.estados_validos` no viene en `estados_disponibles`, agregalo igual al selector y dejalo seleccionado.
- Mantener `compania` al reaplicar filtro (hidden input o merge de query params).
- Boton `Aplicar estados`.

4. Tabla resumen de unidades:
- Encabezados dinamicos con `tipos_unidades`.
- Una fila con `metricas.resumen_unidades_servicio[tipo]`.

5. Tabla principal:
- Columnas fijas:
  - `Companias`
  - `Estado`
  - `Oficial a Cargo`
  - `N Bomberos`
  - `Total especialistas`
  - `Conductor 1`
  - `Conductor 2`
  - `Conductor 3`
  - `Observaciones`
- Columnas dinamicas adicionales con `tipos_unidades`.

6. Render por fila:
- `Companias` -> `fila.compania`
- `Estado` -> `fila.estado`
- `Oficial a Cargo` -> `select` con `fila.oficiales_disponibles`
- `N Bomberos` -> `fila.n_bomberos`
- `Total especialistas` -> `fila.total_especialistas`
- Conductores:
  - `Conductor 1` -> `fila.conductores[0] || ""`
  - `Conductor 2` -> `fila.conductores[1] || ""`
  - `Conductor 3` -> `fila.conductores[2] || ""`
- `Observaciones` -> `textarea`
- Columnas de unidades -> `fila.unidades[tipo] || 0`

7. Persistencia local (igual al esqueleto actual):
- Key: `guardia_report_inputs_v1`
- Forma: objeto por `compania_key`.
- Guardar:
  - `oficial` seleccionado
  - `comentarios` (observaciones)

## Reglas funcionales
- El backend ya calcula `n_bomberos` segun `estado_valido`.
- El frontend no recalcula metricas, solo renderiza lo que llega.
- Debe ser robusto a arreglos vacios o campos faltantes.
- Si `filas` esta vacio, mostrar estado vacio (`Sin datos`).

## Algoritmo recomendado de integracion
1. Leer query params actuales (`compania`, `estado_valido`).
2. Construir URL de consulta a `/report/guardia`.
3. Hacer fetch y parsear JSON.
4. Renderizar header + metricas + selector + tablas.
5. En submit del selector de estados:
- Reenviar query con los `estado_valido` seleccionados.
- Preservar `compania` si estaba presente.
6. Restaurar y persistir `oficial/comentarios` con localStorage.

## Criterios de aceptacion
- Cambiar `estado_valido` modifica `N Bomberos` y totales al refrescar desde API.
- La pantalla replica la estructura principal de `/report/guardia/view`.
- La tabla principal incluye columnas fijas + unidades dinamicas.
- `Oficial a Cargo` y `Observaciones` persisten por `compania_key`.
- No hay dependencia de HTML server-side de `/report/guardia/view`.

## Casos de prueba minimos
- Sin filtros: `/report/guardia`
- Filtro compania: `/report/guardia?compania=1`
- Un estado: `/report/guardia?estado_valido=GUARDIA%20NOCTURNA`
- Multiples estados: `/report/guardia?estado_valido=DISPONIBLE&estado_valido=GUARDIA%20NOCTURNA`
- Sin datos en `filas` (forzando filtro sin match)
