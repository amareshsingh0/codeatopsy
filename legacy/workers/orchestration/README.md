# workers/orchestration

Celery worker(s) that drive judge-mode and autopsy-mode workflows
(section 7) against an ExecutionProvider. Not built yet — Week 2 scope
per section 19 ("submission API, durable jobs"). The provider interface
this will call is in `execution/providers/`.
