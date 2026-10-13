{{- define "aeroos.labels" -}}
app.kubernetes.io/part-of: aeroos
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
aeroos/profile: {{ .Values.profile }}
{{- end -}}

{{- define "aeroos.image" -}}
{{- $digest := index .root.Values.image.digests .name -}}
{{- if $digest -}}
{{ .root.Values.image.registry }}/aeroos-{{ .name }}@{{ $digest }}
{{- else -}}
{{ .root.Values.image.registry }}/aeroos-{{ .name }}:{{ .root.Values.image.tag }}
{{- end -}}
{{- end -}}

{{- define "aeroos.cerbosUrl" -}}
{{- if .Values.cerbos.url -}}{{ .Values.cerbos.url }}{{- else -}}http://{{ .Release.Name }}-cerbos:3592{{- end -}}
{{- end -}}

{{- define "aeroos.commonEnv" -}}
- name: NODE_ENV
  value: production
- name: DB_HOST
  value: {{ required "postgres.host is required" .Values.postgres.host | quote }}
- name: DB_PORT
  value: {{ .Values.postgres.port | quote }}
- name: DB_NAME
  value: {{ .Values.postgres.database | quote }}
- name: KAFKA_BROKERS
  value: {{ required "kafka.brokers is required" .Values.kafka.brokers | quote }}
- name: TEMPORAL_ADDRESS
  value: {{ required "temporal.address is required" .Values.temporal.address | quote }}
- name: TEMPORAL_NAMESPACE
  value: {{ .Values.temporal.namespace | quote }}
{{- end -}}
