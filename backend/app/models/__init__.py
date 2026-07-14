"""
数据库模型
导出所有 ORM 模型
"""
from app.models.base import Base, TimestampMixin
from app.models.user import User, UserRole
from app.models.organization import Brand, Agency, Creator, brand_agency_association, agency_creator_association
from app.models.operator import Operator, OperatorInvite
from app.models.project import Project, project_agency_association
from app.models.task import Task, TaskStage, TaskStatus
from app.models.brief import Brief
from app.models.ai_config import AIConfig
from app.models.review import ReviewTask, Platform
from app.models.rule import ForbiddenWord, WhitelistItem, Competitor, PlatformRule, RuleStatus
from app.models.audit_log import AuditLog
from app.models.message import Message
from app.models.brand_learning import BrandLearnedRule
from app.models.company_profile import AgencyCompanyProfile
from app.models.notification_settings import NotificationSettings
from app.models.xhs import (
    XHSBatchItem,
    XHSBatchJob,
    XHSBrandPack,
    XHSBriefPack,
    XHSDirectionItem,
    XHSExportLog,
    XHSProject,
    XHSProjectVariant,
    XHSRulePack,
    XHSRiskPack,
)
# 保留 Tenant 兼容旧代码，但新代码应使用 Brand
from app.models.tenant import Tenant

__all__ = [
    # Base
    "Base",
    "TimestampMixin",
    # 用户与组织
    "User",
    "UserRole",
    "Brand",
    "Agency",
    "Creator",
    "Operator",
    "OperatorInvite",
    "brand_agency_association",
    "agency_creator_association",
    # 项目与任务
    "Project",
    "project_agency_association",
    "Task",
    "TaskStage",
    "TaskStatus",
    "Brief",
    # AI 配置
    "AIConfig",
    # 审核
    "ReviewTask",
    "Platform",
    # 规则
    "ForbiddenWord",
    "WhitelistItem",
    "Competitor",
    "PlatformRule",
    "RuleStatus",
    # 审计日志
    "AuditLog",
    # 消息
    "Message",
    # 品牌学习
    "BrandLearnedRule",
    # 企业资料 / 通知偏好
    "AgencyCompanyProfile",
    "NotificationSettings",
    # 小红书批量图文
    "XHSRulePack",
    "XHSBrandPack",
    "XHSBriefPack",
    "XHSRiskPack",
    "XHSProject",
    "XHSProjectVariant",
    "XHSDirectionItem",
    "XHSBatchJob",
    "XHSBatchItem",
    "XHSExportLog",
    # 兼容
    "Tenant",
]
