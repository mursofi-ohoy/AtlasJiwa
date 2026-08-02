from fastapi import FastAPI
from app.database import db_pool, test_database
from app.agent_api import router


app = FastAPI(title="Atlas Jiwa API")


@app.on_event("startup")
async def startup():
    await db_pool.open()

    test = await test_database()
    print("[DATABASE TEST]", test)


@app.on_event("shutdown")
async def shutdown():
    await db_pool.close()


app.include_router(router)


@app.get("/")
async def root():
    return {
        "message": "Atlas Jiwa Backend berjalan!"
    }