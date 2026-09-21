#--kind python:default
#--web true
# Note: this timeout is 5 minutes - 10 minutes is max allowed
#--timeout 300000
import types, os, transaction

builder = []
## build-context ##
#--param EXT_POSTGRES_URL "$EXT_POSTGRES_URL"
import psycopg
def init_postgresql(args, ctx):
  dburl = args.get("EXT_POSTGRES_URL", os.getenv("EXT_POSTGRES_URL"))
  ctx.POSTGRESQL = psycopg.connect(dburl)
builder.append(init_postgresql)

def main(args):
  try:
    ctx = types.SimpleNamespace()
    for fn in builder: fn(args, ctx)
    return { "body": transaction.main(args, ctx=ctx) }
  except Exception as e:
    import traceback
    traceback.print_exc()
    return {
      "body": {"error": str(e) },
      "statusCode": 500
    }
