"""
一次性迁移脚本：
- 将旧格式任务名 "宣传任务(N)" 改为 "{项目名} 任务N"
- 将引用旧任务名的历史消息内容同步改为新任务名

用法：
    cd backend
    python migrate_task_names.py
"""
import asyncio
import re
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.message import Message
from app.models.task import Task
from app.models.project import Project


LEGACY_TASK_NAME_PATTERN = re.compile(r"宣传任务\((\d+)\)")


def build_project_task_name(project_name: str, sequence: str | int) -> str:
    return f"{project_name} 任务{sequence}"


async def migrate():
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        # 只查询迁移需要的字段，避免本地库结构与 ORM 模型短暂不一致时整表加载失败
        result = await db.execute(select(Task.id, Task.project_id, Task.name))
        tasks = result.all()
        task_names_by_id: dict[str, str] = {}

        # 查所有项目（id → name 映射）
        proj_result = await db.execute(select(Project))
        projects = {p.id: p.name for p in proj_result.scalars().all()}

        updated_tasks = 0
        for task_id, project_id, task_name in tasks:
            m = LEGACY_TASK_NAME_PATTERN.fullmatch(task_name or "")
            if not m:
                if task_name:
                    task_names_by_id[task_id] = task_name
                continue
            seq = m.group(1)
            project_name = projects.get(project_id, project_id)
            new_name = build_project_task_name(project_name, seq)
            await db.execute(
                update(Task)
                .where(Task.id == task_id)
                .values(name=new_name)
            )
            task_names_by_id[task_id] = new_name
            updated_tasks += 1
            print(f"  {task_id}: 宣传任务({seq}) → {new_name}")

        # 同步更新历史消息中的旧任务名
        msg_result = await db.execute(
            select(Message.id, Message.related_task_id, Message.content)
            .where(Message.related_task_id.is_not(None))
        )
        messages = msg_result.all()
        updated_messages = 0
        for message_id, related_task_id, content in messages:
            task_name = task_names_by_id.get(related_task_id or "")
            if not task_name or not content:
                continue
            new_content, replacements = LEGACY_TASK_NAME_PATTERN.subn(task_name, content)
            if replacements == 0 or new_content == content:
                continue
            await db.execute(
                update(Message)
                .where(Message.id == message_id)
                .values(content=new_content)
            )
            updated_messages += 1
            print(f"  message {message_id}: 已同步任务名为 {task_name}")

        await db.commit()
        print(f"\n完成，共更新 {updated_tasks} 条任务名称，{updated_messages} 条消息内容。")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(migrate())
