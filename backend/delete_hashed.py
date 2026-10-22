import asyncio

import asyncpg


async def main():
    # 连接数据库
    conn = await asyncpg.connect('postgresql://user:pass@localhost:5432/travel_memory')
    
    # 执行删除
    res = await conn.execute("DELETE FROM document WHERE embedding_model = 'hashing-1024@v1';")
    print(f'✅ 删除结果: {res}')
    
    # 检查剩下的向量模型
    rows = await conn.fetch("SELECT embedding_model, count(*) FROM document GROUP BY embedding_model;")
    for row in rows:
        print(f"当前库中: {row['embedding_model']} 共 {row['count']} 条")
        
    await conn.close()

if __name__ == "__main__":
    asyncio.run(main())