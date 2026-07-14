"""
任务相关 Schema
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from app.models.task import TaskStage, TaskStatus


# ===== 通用 =====

class AIReviewResult(BaseModel):
    """AI 审核结果"""
    score: int = Field(..., ge=0, le=100)
    violations: List[dict] = []
    soft_warnings: List[dict] = []
    summary: Optional[str] = None


class ReviewAction(BaseModel):
    """审核操作"""
    action: str = Field(..., pattern="^(pass|reject|force_pass)$")
    comment: Optional[str] = None


# ===== 请求 =====

class TaskCreateRequest(BaseModel):
    """创建任务请求（代理商操作）"""
    project_id: str
    creator_id: Optional[str] = None
    creator_display_name: Optional[str] = None
    creator_platform: Optional[str] = None
    creator_remark: Optional[str] = None
    name: Optional[str] = None  # 不传则自动生成 "{项目名} 任务N"

    @model_validator(mode="after")
    def validate_creator_input(self):
        if self.creator_id:
            return self
        if self.creator_display_name and self.creator_display_name.strip():
            return self
        raise ValueError("请提供达人ID或达人名")


class TaskScriptUploadRequest(BaseModel):
    """上传脚本请求（文件上传或粘贴文字二选一）"""
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    text_content: Optional[str] = None

    @model_validator(mode="after")
    def validate_input(self):
        has_file = bool(self.file_url and self.file_name)
        has_text = bool(self.text_content and self.text_content.strip())
        if not has_file and not has_text:
            raise ValueError("请上传文件或输入脚本文字")
        return self


class TaskVideoUploadRequest(BaseModel):
    """上传视频请求"""
    file_url: str
    file_name: str
    duration: Optional[int] = None  # 秒
    thumbnail_url: Optional[str] = None


class TaskReviewRequest(BaseModel):
    """审核请求"""
    action: str = Field(..., pattern="^(pass|reject|force_pass)$")
    comment: Optional[str] = None
    corrected_script: Optional[str] = None  # 代理商修正后的脚本文本（pass 时可携带）
    corrected_file_url: Optional[str] = None
    corrected_file_name: Optional[str] = None
    corrected_file_type: Optional[str] = None


class ReviewCandidatePayload(BaseModel):
    """达人修改图候选项"""
    id: str
    category: str = Field(..., pattern="^(voice|bgm|content)$")
    start_sec: int = Field(..., ge=0)
    end_sec: int = Field(..., ge=0)
    time_range: Optional[str] = None
    priority: str = Field(default="medium", pattern="^(high|medium|low)$")
    problem: str = Field(..., min_length=1)
    direct_fix: str = Field(..., min_length=1)
    where_to_change: str = Field(..., min_length=1)
    suggested_copy: Optional[str] = None
    bgm_action: Optional[str] = None
    evidence: Optional[str] = None


class CreatorGuidanceBoardRequest(BaseModel):
    """生成达人修改图请求"""
    candidates: List[ReviewCandidatePayload] = Field(default_factory=list)
    layout_variant: Optional[str] = Field(default=None, pattern="^(portrait|landscape)$")
    style_variant: Optional[str] = None
    feedback_instruction: Optional[str] = None
    feedback_type: Optional[str] = Field(default=None, pattern="^(layout|style|tone|content_density|other)$")
    target_page: Optional[int] = Field(default=None, ge=1)


class ViolationItem(BaseModel):
    id: str
    violation_content: str
    suggestion: str

class ScriptAIRewriteRequest(BaseModel):
    """AI 影子写手重写请求"""
    full_script: str = Field(..., description="完整原始脚本（用于风格分析）")
    segment: str = Field(..., description="需要重写的违规片段")
    violation_content: str = Field(..., description="违规内容描述（单项）")
    suggestion: str = Field(..., description="修改方向建议（单项）")
    brand_context: Optional[str] = Field(None, description="品牌/产品上下文")
    # 批量模式：同时处理多个违规
    violations: Optional[List[ViolationItem]] = Field(None, description="批量违规列表（传此字段时忽略单项字段）")


class AppealRequest(BaseModel):
    """申诉请求"""
    reason: str = Field(..., min_length=1)


class AppealCountRequest(BaseModel):
    """申请增加申诉次数请求"""
    task_id: str


class AppealCountActionRequest(BaseModel):
    """处理申诉次数请求"""
    action: str = Field(..., pattern="^(approve|reject)$")


# ===== 响应 =====

class CreatorInfo(BaseModel):
    """达人信息"""
    id: Optional[str] = None
    name: str
    avatar: Optional[str] = None
    platform: Optional[str] = None
    remark: Optional[str] = None


class AgencyInfo(BaseModel):
    """代理商信息"""
    id: str
    name: str


class ProjectInfo(BaseModel):
    """项目信息"""
    id: str
    name: str
    brand_name: Optional[str] = None
    client_display_name: Optional[str] = None
    brand_display_name: Optional[str] = None
    project_remark: Optional[str] = None
    platform: Optional[str] = None


class TaskResponse(BaseModel):
    """任务响应"""
    id: str
    name: str
    sequence: int
    stage: TaskStage

    # 关联信息
    project: ProjectInfo
    agency: AgencyInfo
    creator: CreatorInfo

    # 脚本信息
    script_file_url: Optional[str] = None
    script_file_name: Optional[str] = None
    script_text_content: Optional[str] = None
    script_uploaded_at: Optional[datetime] = None
    script_ai_score: Optional[int] = None
    script_ai_result: Optional[dict] = None
    script_agency_corrected: Optional[str] = None  # 代理商修正后的脚本
    script_agency_corrected_file_url: Optional[str] = None
    script_agency_corrected_file_name: Optional[str] = None
    script_agency_corrected_file_type: Optional[str] = None
    script_agency_status: Optional[TaskStatus] = None
    script_agency_comment: Optional[str] = None
    script_agency_reviewed_at: Optional[datetime] = None
    script_brand_status: Optional[TaskStatus] = None
    script_brand_comment: Optional[str] = None
    script_brand_reviewed_at: Optional[datetime] = None

    # 视频信息
    video_file_url: Optional[str] = None
    video_file_name: Optional[str] = None
    video_duration: Optional[int] = None
    video_thumbnail_url: Optional[str] = None
    video_uploaded_at: Optional[datetime] = None
    video_ai_score: Optional[int] = None
    video_ai_result: Optional[dict] = None
    video_agency_status: Optional[TaskStatus] = None
    video_agency_comment: Optional[str] = None
    video_agency_reviewed_at: Optional[datetime] = None
    video_brand_status: Optional[TaskStatus] = None
    video_brand_comment: Optional[str] = None
    video_brand_reviewed_at: Optional[datetime] = None

    # 申诉
    appeal_count: int = 1
    is_appeal: bool = False
    appeal_reason: Optional[str] = None
    appeal_request_status: Optional[str] = None

    # 时间
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TaskListResponse(BaseModel):
    """任务列表响应"""
    items: List[TaskResponse]
    total: int
    page: int
    page_size: int


class TaskSummary(BaseModel):
    """任务摘要（用于列表）"""
    id: str
    name: str
    stage: TaskStage
    creator_name: str
    creator_avatar: Optional[str] = None
    project_name: str
    is_appeal: bool = False
    appeal_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReviewTaskListResponse(BaseModel):
    """待审核任务列表响应"""
    items: List[TaskSummary]
    total: int
    page: int
    page_size: int
