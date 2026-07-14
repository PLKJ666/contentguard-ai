"""
关键帧提取服务
使用 FFmpeg 从视频中提取关键帧用于视觉分析
"""
import asyncio
import base64
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class KeyFrame:
    """关键帧数据"""
    timestamp: float  # 时间戳（秒）
    file_path: str  # 帧图片路径
    width: int = 0
    height: int = 0

    def to_base64(self) -> str:
        """将帧图片转为 base64"""
        with open(self.file_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

    def to_data_url(self) -> str:
        """将帧图片转为 data URL"""
        return f"data:image/jpeg;base64,{self.to_base64()}"


@dataclass
class ExtractionResult:
    """提取结果"""
    success: bool
    frames: list[KeyFrame] = field(default_factory=list)
    video_duration: float = 0.0
    error: Optional[str] = None
    output_dir: Optional[str] = None


class KeyFrameExtractor:
    """关键帧提取器"""

    def __init__(
        self,
        ffmpeg_path: str = "ffmpeg",
        ffprobe_path: str = "ffprobe",
        output_format: str = "jpg",
        quality: int = 2,  # 1-31, 越小质量越高
    ):
        """
        初始化提取器

        Args:
            ffmpeg_path: ffmpeg 可执行文件路径
            ffprobe_path: ffprobe 可执行文件路径
            output_format: 输出格式 (jpg/png)
            quality: JPEG 质量 (1-31)
        """
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path
        self.output_format = output_format
        self.quality = quality

    def _check_ffmpeg(self) -> bool:
        """检查 FFmpeg 是否可用"""
        return shutil.which(self.ffmpeg_path) is not None

    async def get_video_info(self, video_path: str) -> dict:
        """
        获取视频信息

        Args:
            video_path: 视频文件路径

        Returns:
            视频信息字典
        """
        cmd = [
            self.ffprobe_path,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            video_path,
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await process.communicate()

            import json
            info = json.loads(stdout.decode())

            # 提取关键信息
            duration = float(info.get("format", {}).get("duration", 0))
            video_stream = next(
                (s for s in info.get("streams", []) if s.get("codec_type") == "video"),
                {}
            )

            return {
                "duration": duration,
                "width": video_stream.get("width", 0),
                "height": video_stream.get("height", 0),
                "fps": (lambda r: int(r[0]) / int(r[1]) if len(r) == 2 and r[1] != "0" else 0)(video_stream.get("r_frame_rate", "0/1").split("/")) if "/" in video_stream.get("r_frame_rate", "0") else 0,
                "codec": video_stream.get("codec_name", ""),
            }
        except Exception as e:
            return {"error": str(e), "duration": 0}

    async def extract_at_intervals(
        self,
        video_path: str,
        interval_seconds: float = 1.0,
        max_frames: int = 60,
        output_dir: Optional[str] = None,
    ) -> ExtractionResult:
        """
        按时间间隔提取帧

        Args:
            video_path: 视频文件路径
            interval_seconds: 提取间隔（秒）
            max_frames: 最大帧数
            output_dir: 输出目录，默认创建临时目录

        Returns:
            ExtractionResult: 提取结果
        """
        if not self._check_ffmpeg():
            return ExtractionResult(
                success=False,
                error="FFmpeg 未安装或不在 PATH 中",
            )

        # 获取视频信息
        video_info = await self.get_video_info(video_path)
        duration = video_info.get("duration", 0)

        if duration <= 0:
            return ExtractionResult(
                success=False,
                error="无法获取视频时长",
            )

        # 创建输出目录
        if output_dir is None:
            output_dir = tempfile.mkdtemp(prefix="keyframes_")
        else:
            Path(output_dir).mkdir(parents=True, exist_ok=True)

        # 计算实际帧数
        frame_count = min(int(duration / interval_seconds), max_frames)
        if frame_count <= 0:
            frame_count = 1

        # 使用 FFmpeg 提取帧
        output_pattern = os.path.join(output_dir, f"frame_%04d.{self.output_format}")
        cmd = [
            self.ffmpeg_path,
            "-i", video_path,
            "-vf", f"fps=1/{interval_seconds}",
            "-frames:v", str(frame_count),
            "-q:v", str(self.quality),
            "-y",
            output_pattern,
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await process.communicate()

            if process.returncode != 0:
                return ExtractionResult(
                    success=False,
                    error=f"FFmpeg 错误: {stderr.decode()[:200]}",
                    output_dir=output_dir,
                )

            # 收集提取的帧
            frames = []
            for i in range(1, frame_count + 1):
                frame_path = os.path.join(output_dir, f"frame_{i:04d}.{self.output_format}")
                if os.path.exists(frame_path):
                    timestamp = (i - 1) * interval_seconds
                    frames.append(KeyFrame(
                        timestamp=timestamp,
                        file_path=frame_path,
                        width=video_info.get("width", 0),
                        height=video_info.get("height", 0),
                    ))

            return ExtractionResult(
                success=True,
                frames=frames,
                video_duration=duration,
                output_dir=output_dir,
            )

        except Exception as e:
            return ExtractionResult(
                success=False,
                error=str(e),
                output_dir=output_dir,
            )

    async def extract_scene_changes(
        self,
        video_path: str,
        threshold: float = 0.3,
        max_frames: int = 30,
        output_dir: Optional[str] = None,
    ) -> ExtractionResult:
        """
        基于场景变化提取关键帧

        Args:
            video_path: 视频文件路径
            threshold: 场景变化阈值 (0-1)
            max_frames: 最大帧数
            output_dir: 输出目录

        Returns:
            ExtractionResult: 提取结果
        """
        if not self._check_ffmpeg():
            return ExtractionResult(
                success=False,
                error="FFmpeg 未安装或不在 PATH 中",
            )

        video_info = await self.get_video_info(video_path)
        duration = video_info.get("duration", 0)

        if output_dir is None:
            output_dir = tempfile.mkdtemp(prefix="keyframes_")
        else:
            Path(output_dir).mkdir(parents=True, exist_ok=True)

        output_pattern = os.path.join(output_dir, f"scene_%04d.{self.output_format}")

        # 使用场景检测滤镜
        cmd = [
            self.ffmpeg_path,
            "-i", video_path,
            "-vf", f"select='gt(scene,{threshold})',showinfo",
            "-vsync", "vfr",
            "-frames:v", str(max_frames),
            "-q:v", str(self.quality),
            "-y",
            output_pattern,
        ]

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await process.communicate()

            # 解析时间戳
            timestamps = []
            for line in stderr.decode().split("\n"):
                if "pts_time:" in line:
                    try:
                        pts_part = line.split("pts_time:")[1].split()[0]
                        timestamps.append(float(pts_part))
                    except (IndexError, ValueError):
                        pass

            # 收集帧
            frames = []
            for i, ts in enumerate(timestamps[:max_frames], 1):
                frame_path = os.path.join(output_dir, f"scene_{i:04d}.{self.output_format}")
                if os.path.exists(frame_path):
                    frames.append(KeyFrame(
                        timestamp=ts,
                        file_path=frame_path,
                        width=video_info.get("width", 0),
                        height=video_info.get("height", 0),
                    ))

            # 如果场景检测帧太少，补充均匀采样
            if len(frames) < 5 and duration > 0:
                interval_result = await self.extract_at_intervals(
                    video_path,
                    interval_seconds=duration / 10,
                    max_frames=10,
                    output_dir=output_dir,
                )
                if interval_result.success:
                    # 合并并去重
                    existing_ts = {f.timestamp for f in frames}
                    for f in interval_result.frames:
                        if f.timestamp not in existing_ts:
                            frames.append(f)
                    frames.sort(key=lambda x: x.timestamp)

            return ExtractionResult(
                success=True,
                frames=frames[:max_frames],
                video_duration=duration,
                output_dir=output_dir,
            )

        except Exception as e:
            return ExtractionResult(
                success=False,
                error=str(e),
                output_dir=output_dir,
            )

    def cleanup(self, output_dir: str) -> bool:
        """
        清理提取的临时文件

        Args:
            output_dir: 输出目录

        Returns:
            是否成功删除
        """
        try:
            if os.path.exists(output_dir):
                shutil.rmtree(output_dir)
                return True
        except OSError:
            pass
        return False


# 全局实例
_extractor: Optional[KeyFrameExtractor] = None


def get_keyframe_extractor() -> KeyFrameExtractor:
    """获取关键帧提取器单例"""
    global _extractor
    if _extractor is None:
        _extractor = KeyFrameExtractor()
    return _extractor
