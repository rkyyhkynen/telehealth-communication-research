import os
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("GLOG_minloglevel", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

from fastapi import Body, FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import cv2
import numpy as np
import mediapipe as mp
from deepface import DeepFace
import io
import base64
from pydub import AudioSegment
from pydub.silence import detect_nonsilent
import tempfile
import time
import json
import logging
import atexit
import threading
import subprocess
import requests
import re

import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field, ValidationError

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
for noisy_logger_name in ("httpx", "httpcore", "huggingface_hub", "urllib3"):
    logging.getLogger(noisy_logger_name).setLevel(logging.WARNING)

app = FastAPI()

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
DEFAULT_PIPER_MODEL_PATH = os.path.join(PROJECT_ROOT, 'models', 'piper', 'fi_FI-harri-medium.onnx')
DEFAULT_PIPER_CONFIG_PATH = f"{DEFAULT_PIPER_MODEL_PATH}.json"

# Constants for thresholds
THRESHOLD_GAZE = 0.5
THRESHOLD_GAZE_DOWN = 0.55
THRESHOLD_GAZE_UP = 0.22
THRESHOLD_GAZE_UP_SECONDARY = 0.17
GAZE_DIRECTION_MARGIN = 0.02
THRESHOLD_BROW_DOWN = 0.2
THRESHOLD_BROW_UP = 0.6
NODDING_THRESHOLD = 4.5
SHAKING_THRESHOLD = 8.8
NODDING_COOLDOWN = 2.8
SHAKING_COOLDOWN = 2.8
MOTION_HISTORY_WINDOW_SECONDS = 4.0
MOTION_HISTORY_MAX_POINTS = 12
MOTION_SMOOTHING_ALPHA = 0.35
MOTION_RANGE_MULTIPLIER = 1.25
MOTION_STEP_MULTIPLIER = 0.25
EMOTION_CONFIDENCE_THRESHOLD = 0.8
HEAD_POSE_YAW_LEFT_THRESHOLD = -16.0
HEAD_POSE_YAW_RIGHT_THRESHOLD = 14.0
HEAD_POSE_PITCH_DOWN_THRESHOLD = -7.0
HEAD_POSE_PITCH_UP_THRESHOLD = 15.0
HEAD_POSE_PROFILE_EYE_DISTANCE_THRESHOLD = 0.14

OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'http://localhost:11434').strip() or 'http://localhost:11434'
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'gemma3:4b').strip() or 'gemma3:4b'
PATIENT_OLLAMA_MODEL = os.getenv('PATIENT_OLLAMA_MODEL', 'gemma3:4b').strip() or 'gemma3:4b'
OLLAMA_TIMEOUT = 45

API_HOST = os.getenv('API_HOST', '0.0.0.0')
API_PORT = int(os.getenv('API_PORT', '5000'))
API_SSL_CERT = os.getenv('API_SSL_CERT', os.path.join(PROJECT_ROOT, 'certs', 'cert.pem'))
API_SSL_KEY = os.getenv('API_SSL_KEY', os.path.join(PROJECT_ROOT, 'certs', 'key.pem'))

cors_origins_raw = os.getenv('API_CORS_ORIGINS', '*').strip()
if cors_origins_raw == '*':
    cors_origins = ['*']
else:
    cors_origins = [origin.strip() for origin in cors_origins_raw.split(',') if origin.strip()]
    if not cors_origins:
        cors_origins = ['*']

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

PATIENT_PIPER_MODEL_PATH = os.getenv('PATIENT_PIPER_MODEL_PATH', DEFAULT_PIPER_MODEL_PATH).strip()
PATIENT_PIPER_CONFIG_PATH = f"{PATIENT_PIPER_MODEL_PATH}.json" if PATIENT_PIPER_MODEL_PATH else DEFAULT_PIPER_CONFIG_PATH
PATIENT_PIPER_BIN = os.getenv('PATIENT_PIPER_BIN', 'piper').strip() or 'piper'
PATIENT_PIPER_SPEAKER_ID = ''
PATIENT_PIPER_MAX_CHARS = 500
PATIENT_PIPER_TIMEOUT_SECONDS = int(os.getenv('PATIENT_PIPER_TIMEOUT_SECONDS', '90'))
PATIENT_REPLY_MAX_CHARS = 180
PATIENT_REPLY_MAX_SENTENCES = 2
PATIENT_FALLBACK_REPLY = "Olen potilas. Minulla on ollut päänsärkyä ja huimausta neljä päivää."

TRACKER_TTL_SECONDS = 1800
TRACKER_CLEANUP_INTERVAL_SECONDS = 300

LLM_CHAT_MAX_ITEMS = 20
LLM_CHAT_MAX_CONTENT_LENGTH = 2000
LLM_CHAT_MAX_RESPONSE_CHARS = 380
LLM_CHAT_MAX_SENTENCES = 3
LLM_CHAT_NUM_PREDICT = 180

AUDIO_SILENCE_THRESHOLD_DB = -52.0
AUDIO_MIN_SILENCE_LEN_MS = 700
AUDIO_MIN_SPEECH_CHUNK_MS = 120
AUDIO_MIN_SPEECH_MS = 180
AUDIO_LOW_SPEECH_SECONDS = 0.35
AUDIO_LOW_SPEECH_MAX_TEXT_CHARS = 8
AUDIO_COMPACT_MIN_TOTAL_MS = 25000
AUDIO_COMPACT_MIN_SAVINGS_MS = 5000
ASR_CHUNK_FALLBACK_MS = 25000
WHISPER_LONGFORM_THRESHOLD_MS = 29000

WHISPER_MODEL = os.getenv('WHISPER_MODEL', 'Finnish-NLP/whisper-medium-finnish').strip() or 'Finnish-NLP/whisper-medium-finnish'
WHISPER_DEVICE = os.getenv('WHISPER_DEVICE', 'auto').strip().lower() or 'auto'
WHISPER_LANGUAGE = 'fi'
WHISPER_SAMPLE_RATE = 16000

class DirectionStatsPayload(BaseModel):
    counts: Dict[str, int] = Field(default_factory=dict)
    percentages: Dict[str, float] = Field(default_factory=dict)
    total: int = 0

class NoddingShakingPayload(BaseModel):
    nodCount: int = 0
    shakeCount: int = 0
    stillCount: int = 0

class ShoulderVisibilityPayload(BaseModel):
    visibleCount: int = 0
    notVisibleCount: int = 0
    visiblePercentage: float = 0.0
    notVisiblePercentage: float = 0.0

class BrowSummaryPayload(BaseModel):
    neutrals: int = 0
    raised: int = 0
    lowered: int = 0
    activity: int = 0
    totalBrowData: int = 0
    neutralPercentage: str = "0.00"
    raisedPercentage: str = "0.00"
    loweredPercentage: str = "0.00"
    activityPercentage: str = "0.00"

class SpeechMarkerTopFillerPayload(BaseModel):
    word: str
    count: int

class SpeechMarkerSummaryPayload(BaseModel):
    openEndedQuestionCount: int = 0
    questionExamples: List[str] = Field(default_factory=list)
    fillerWordCount: int = 0
    topFillers: List[SpeechMarkerTopFillerPayload] = Field(default_factory=list)

class AnalysisFeaturesPayload(BaseModel):
    emotionCounts: Dict[str, int] = Field(default_factory=dict)
    emotionPercentages: Dict[str, float] = Field(default_factory=dict)
    uniqueEmotionCount: int = 0
    gazeCenterPercentage: float = 0.0
    gazeBreakdown: DirectionStatsPayload = Field(default_factory=DirectionStatsPayload)
    headPoseBreakdown: DirectionStatsPayload = Field(default_factory=DirectionStatsPayload)
    noddingShaking: NoddingShakingPayload = Field(default_factory=NoddingShakingPayload)
    shoulderVisibility: ShoulderVisibilityPayload = Field(default_factory=ShoulderVisibilityPayload)
    browData: BrowSummaryPayload = Field(default_factory=BrowSummaryPayload)
    speakingTimePercentage: Optional[float] = None
    callDuration: Optional[float] = None
    transcript: str = ""
    speechMarkers: Optional[SpeechMarkerSummaryPayload] = None

class ChatMessagePayload(BaseModel):
    role: Literal['user', 'assistant']
    content: str

class LlmAnalysisRequestPayload(BaseModel):
    features: AnalysisFeaturesPayload
    locale: Literal['en', 'fi'] = 'en'

class LlmChatRequestPayload(BaseModel):
    features: AnalysisFeaturesPayload
    conversation: List[ChatMessagePayload] = Field(default_factory=list)
    locale: Literal['en', 'fi'] = 'en'

class HeadTracker:
    def __init__(self):
        self.angle_history = []
        self.y_angle_history = []
        self.last_angle_time = 0
        self.last_shake_time = 0
        self.last_seen = time.time()
        self.last_looking_direction = "Forward"
    
    def update_angles(self, x_angle, y_angle, current_time):
        self.last_seen = current_time
        smoothed_x = x_angle
        smoothed_y = y_angle

        if self.angle_history:
            smoothed_x = ((1.0 - MOTION_SMOOTHING_ALPHA) * self.angle_history[-1][1]) + (MOTION_SMOOTHING_ALPHA * x_angle)
        if self.y_angle_history:
            smoothed_y = ((1.0 - MOTION_SMOOTHING_ALPHA) * self.y_angle_history[-1][1]) + (MOTION_SMOOTHING_ALPHA * y_angle)

        self.angle_history.append((current_time, smoothed_x))
        self.y_angle_history.append((current_time, smoothed_y))

        cutoff_time = current_time - MOTION_HISTORY_WINDOW_SECONDS
        self.angle_history = [
            item for item in self.angle_history
            if item[0] >= cutoff_time
        ][-MOTION_HISTORY_MAX_POINTS:]
        self.y_angle_history = [
            item for item in self.y_angle_history
            if item[0] >= cutoff_time
        ][-MOTION_HISTORY_MAX_POINTS:]
            
    def clear_angle_history(self):
        self.angle_history.clear()
        
    def clear_y_angle_history(self):
        self.y_angle_history.clear()
        
    def set_last_angle_time(self, time):
        self.last_angle_time = time
        
    def set_last_shake_time(self, time):
        self.last_shake_time = time

    def touch(self, current_time):
        self.last_seen = current_time

client_trackers = {}
client_trackers_lock = threading.Lock()
last_tracker_cleanup = 0.0

def get_tracker_for_client(client_id):
    global last_tracker_cleanup

    with client_trackers_lock:
        now = time.time()
        if now - last_tracker_cleanup >= TRACKER_CLEANUP_INTERVAL_SECONDS:
            stale_ids = [
                cid for cid, tracker in client_trackers.items()
                if now - tracker.last_seen > TRACKER_TTL_SECONDS
            ]
            for stale_id in stale_ids:
                client_trackers.pop(stale_id, None)
            last_tracker_cleanup = now

        if client_id not in client_trackers:
            client_trackers[client_id] = HeadTracker()
        client_trackers[client_id].touch(now)
        return client_trackers[client_id]

# Initialize models
face_model_path = os.path.join(CURRENT_DIR, 'face_landmarker.task')
pose_model_path = os.path.join(CURRENT_DIR, 'pose_landmarker_lite.task')

if WHISPER_DEVICE == 'cpu':
    resolved_whisper_device = 'cpu'
elif WHISPER_DEVICE == 'mps':
    resolved_whisper_device = 'mps' if torch.backends.mps.is_available() else 'cpu'
else:
    resolved_whisper_device = 'mps' if torch.backends.mps.is_available() else 'cpu'

whisper_mps_fp16 = os.getenv('WHISPER_MPS_FP16', '0').strip().lower() in ('1', 'true', 'yes', 'on')
resolved_whisper_dtype = (
    torch.float16 if (resolved_whisper_device == 'mps' and whisper_mps_fp16) else torch.float32
)

try:
    whisper_processor = AutoProcessor.from_pretrained(WHISPER_MODEL)
except Exception as exc:
    try:
        logger.warning(
            f"Whisper processor network lookup failed ({exc}); retrying with local cache only."
        )
        whisper_processor = AutoProcessor.from_pretrained(WHISPER_MODEL, local_files_only=True)
    except Exception as local_exc:
        raise RuntimeError(f"Failed to initialize Whisper processor: {local_exc}") from local_exc

def _load_whisper_model(local_files_only=False):
    try:
        return AutoModelForSpeechSeq2Seq.from_pretrained(
            WHISPER_MODEL,
            dtype=resolved_whisper_dtype,
            local_files_only=local_files_only
        )
    except TypeError:
        return AutoModelForSpeechSeq2Seq.from_pretrained(
            WHISPER_MODEL,
            torch_dtype=resolved_whisper_dtype,
            local_files_only=local_files_only
        )

try:
    whisper_model = _load_whisper_model(local_files_only=False)
except Exception as exc:
    try:
        logger.warning(
            f"Whisper model network lookup failed ({exc}); retrying with local cache only."
        )
        whisper_model = _load_whisper_model(local_files_only=True)
    except Exception as local_exc:
        raise RuntimeError(f"Failed to initialize Whisper model: {local_exc}") from local_exc

try:
    whisper_model.to(resolved_whisper_device)
    if resolved_whisper_device == 'cpu':
        whisper_model.float()

    whisper_model.eval()
    generation_config = whisper_model.generation_config

    if hasattr(generation_config, 'task_to_id'):
        generation_config.task = "transcribe"
    if hasattr(generation_config, 'lang_to_id'):
        generation_config.language = WHISPER_LANGUAGE

    generation_config.return_timestamps = False
    generation_config.forced_decoder_ids = None
    if hasattr(generation_config, 'begin_suppress_tokens'):
        generation_config.begin_suppress_tokens = None
    if hasattr(generation_config, 'suppress_tokens'):
        generation_config.suppress_tokens = None
except Exception as exc:
    raise RuntimeError(f"Failed to initialize Whisper generation config: {exc}") from exc
logger.info(
    f"Whisper initialized with model='{WHISPER_MODEL}', "
    f"device='{resolved_whisper_device}', dtype='{resolved_whisper_dtype}'"
)

BaseOptions = mp.tasks.BaseOptions
FaceLandmarker = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
FaceLandmarkerResult = mp.tasks.vision.FaceLandmarkerResult
PoseLandmarker = mp.tasks.vision.PoseLandmarker
PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

options = FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=face_model_path),
    running_mode=VisionRunningMode.IMAGE,
    output_face_blendshapes=True)

face_landmarker = FaceLandmarker.create_from_options(options)
if os.path.exists(pose_model_path):
    pose_options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=pose_model_path),
        running_mode=VisionRunningMode.IMAGE,
        num_poses=1
    )
    pose_landmarker = PoseLandmarker.create_from_options(pose_options)
    logger.info(f"Pose landmarker initialized from '{pose_model_path}'")
else:
    pose_landmarker = None
    logger.warning(
        f"Pose model not found at '{pose_model_path}'. "
        "Shoulder visibility will be reported as N/A."
    )

face_landmarker_lock = threading.Lock()
pose_landmarker_lock = threading.Lock()
emotion_detector_lock = threading.Lock()
whisper_lock = threading.Lock()
FACE_POSE_KEYPOINT_INDICES = (33, 263, 1, 61, 291, 199)
POSE_LEFT_SHOULDER_INDEX = 11
POSE_RIGHT_SHOULDER_INDEX = 12

@atexit.register
def _cleanup_face_landmarker():
    try:
        face_landmarker.close()
    except Exception:
        pass
    if pose_landmarker is not None:
        try:
            pose_landmarker.close()
        except Exception:
            pass

@app.get('/')
def hello():
    return {"status": "ok", "service": "callpython-api"}

@app.post('/')
def upload(
    request: Request,
    image: Optional[UploadFile] = File(default=None),
    timestamp: Optional[str] = Form(default=None),
    client_id: Optional[str] = Form(default=None),
):
    try:
        if image is None:
            return JSONResponse(content={"error": "No image file provided."}, status_code=400)
        file_contents = image.file.read()
        resolved_client_id = client_id or (request.client.host if request.client else 'unknown')

        if not file_contents:
            return JSONResponse(content={"error": "No image file provided."}, status_code=400)

        response_data, status_code = process_image(file_contents, timestamp, resolved_client_id)
        return JSONResponse(content=response_data, status_code=status_code)
    
    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        return JSONResponse(content={"error": "An error occurred while processing the image."}, status_code=500)

@app.post('/upload-audio')
def upload_audio(
    request: Request,
    audio: Optional[UploadFile] = File(default=None),
    duration: Optional[str] = Form(default=None),
    client_id: Optional[str] = Form(default=None),
):
    resolved_client_id = client_id or (request.client.host if request.client else 'unknown')
    
    if audio:
        audio_contents = audio.file.read()
        try:
            source_format = infer_audio_format(audio.filename, audio.content_type)
            audioProcess = analyze_audio(audio_contents, resolved_client_id, source_format=source_format)
            if isinstance(audioProcess, dict) and audioProcess.get('error'):
                logger.error(
                    f"Audio analysis failed for client {resolved_client_id}: "
                    f"{audioProcess.get('error')}"
                )
                status_code = 500
                error_message = str(audioProcess.get('error', ''))
                if 'Invalid audio format' in error_message:
                    status_code = 400
                return JSONResponse(
                    content={
                        "status": "error",
                        "message": audioProcess.get('error'),
                        "duration": duration,
                        "client_id": resolved_client_id,
                        "audioResult": audioProcess
                    },
                    status_code=status_code
                )
            return JSONResponse(
                content={"duration": duration, "client_id": resolved_client_id, "audioResult": audioProcess},
                status_code=200
            )
        except Exception as e:
            logger.error(f"Error processing audio for client {resolved_client_id}: {str(e)}")
            return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)
    else:
        return JSONResponse(content={"status": "error", "message": "No audio file provided."}, status_code=400)

def print_result(result: FaceLandmarkerResult):  # type: ignore
    gaze_text = "N/A"
    brow_text = "N/A"

    if result.face_blendshapes:
        face_blendshapes = result.face_blendshapes[0]
        eye_look_scores = {category.category_name: category.score for category in face_blendshapes if "eyeLook" in category.category_name}
        brown_scores = {category.category_name: category.score for category in face_blendshapes if "brow" in category.category_name}

        if brown_scores.get("browDownLeft", 0) > THRESHOLD_BROW_DOWN and brown_scores.get("browDownRight", 0) > THRESHOLD_BROW_DOWN:
            brow_text = "Brow Down"
        elif (
            brown_scores.get("browInnerUp", 0) > THRESHOLD_BROW_UP or
            brown_scores.get("browOuterUpLeft", 0) > THRESHOLD_BROW_UP or
            brown_scores.get("browOuterUpRight", 0) > THRESHOLD_BROW_UP
        ):
            brow_text = "Brow Up"
        else:
            brow_text = "Brow neutral"

        left_score = min(eye_look_scores.get("eyeLookInRight", 0), eye_look_scores.get("eyeLookOutLeft", 0))
        right_score = min(eye_look_scores.get("eyeLookOutRight", 0), eye_look_scores.get("eyeLookInLeft", 0))
        down_score = min(eye_look_scores.get("eyeLookDownLeft", 0), eye_look_scores.get("eyeLookDownRight", 0))
        up_left = eye_look_scores.get("eyeLookUpLeft", 0)
        up_right = eye_look_scores.get("eyeLookUpRight", 0)
        up_score = (up_left + up_right) / 2.0

        direction_scores = [
            ("Gaze left", left_score, THRESHOLD_GAZE),
            ("Gaze right", right_score, THRESHOLD_GAZE),
            ("Gaze down", down_score, THRESHOLD_GAZE_DOWN),
            ("Gaze up", up_score, THRESHOLD_GAZE_UP),
        ]
        ranked = sorted(direction_scores, key=lambda item: item[1], reverse=True)
        best_direction, best_score, best_threshold = ranked[0]
        second_best_score = ranked[1][1] if len(ranked) > 1 else 0.0

        if (
            best_direction == "Gaze up"
            and max(up_left, up_right) >= THRESHOLD_GAZE_UP
            and min(up_left, up_right) >= THRESHOLD_GAZE_UP_SECONDARY
            and (best_score - second_best_score) >= GAZE_DIRECTION_MARGIN
        ):
            gaze_text = "Gaze up"
        elif best_score >= best_threshold and (best_score - second_best_score) >= GAZE_DIRECTION_MARGIN:
            gaze_text = best_direction
        else:
            gaze_text = "Gaze center"

    return gaze_text, brow_text

def build_llm_metrics_summary(features):
    sections = []
    def pct(value):
        try:
            return max(0, min(100, int(round(float(value)))))
        except (TypeError, ValueError):
            return 0

    emotions = features.get('emotionPercentages') or {}
    if emotions:
        emotion_lines = [
            f"- {emotion}: {pct(percent)}%"
            for emotion, percent in emotions.items()
        ]
        sections.append("Emotion distribution:\n" + "\n".join(emotion_lines))

    gaze_center = features.get('gazeCenterPercentage')
    if gaze_center is not None:
        sections.append(f"Eye contact (gaze center): {pct(gaze_center)}%")

    gaze_breakdown = features.get('gazeBreakdown') or {}
    gaze_percentages = gaze_breakdown.get('percentages') if isinstance(gaze_breakdown, dict) else None
    if gaze_percentages:
        readable = []
        label_map = {
            'Gaze center': 'Center',
            'Gaze left': 'Left',
            'Gaze right': 'Right',
            'Gaze up': 'Up',
            'Gaze down': 'Down'
        }
        for key, label in label_map.items():
            if key in gaze_percentages:
                readable.append(f"{label}: {pct(gaze_percentages[key])}%")
        if readable:
            sections.append("Gaze distribution: " + ", ".join(readable))

    nodding = features.get('noddingShaking') or {}
    if nodding:
        sections.append(
            f"Nods: {nodding.get('nodCount', 0)}, "
            f"Head shakes: {nodding.get('shakeCount', 0)}, "
            f"Still frames: {nodding.get('stillCount', 0)}"
        )

    shoulders = features.get('shoulderVisibility') or {}
    if shoulders:
        visible_pct = pct(shoulders.get('visiblePercentage', 0))
        sections.append(f"Shoulders visible: {visible_pct}% ({shoulders.get('visibleCount', 0)} frames)")

    brow_data = features.get('browData') or {}
    if brow_data:
        sections.append(
            "Brow positions (neutral/raised/lowered %): "
            f"{pct(brow_data.get('neutralPercentage', 0))}/"
            f"{pct(brow_data.get('raisedPercentage', 0))}/"
            f"{pct(brow_data.get('loweredPercentage', 0))}"
        )

    speaking_time = features.get('speakingTimePercentage')
    if speaking_time is not None:
        sections.append(f"Speaking time vs call duration: {pct(speaking_time)}%")

    call_duration = features.get('callDuration')
    if call_duration is not None:
        sections.append(f"Call duration (seconds): {call_duration}")

    transcript = features.get('transcript') or ''
    head_pose_breakdown = features.get('headPoseBreakdown') or {}
    head_pose_percentages = head_pose_breakdown.get('percentages') if isinstance(head_pose_breakdown, dict) else None
    if head_pose_percentages:
        label_map = {
            'Forward': 'Forward',
            'Looking Left': 'Left',
            'Looking Right': 'Right',
            'Looking Up': 'Up',
            'Looking Down': 'Down'
        }
        readable = []
        for key, label in label_map.items():
            if key in head_pose_percentages:
                readable.append(f"{label}: {pct(head_pose_percentages[key])}%")
        if readable:
            sections.append("Head pose distribution: " + ", ".join(readable))
    transcript_excerpt = transcript[:800] if transcript else ''
    if transcript_excerpt:
        sections.append("Transcript excerpt:\n" + transcript_excerpt)

    speech_markers = features.get('speechMarkers') or {}
    if isinstance(speech_markers, dict) and speech_markers:
        open_count = speech_markers.get('openEndedQuestionCount')
        if open_count is not None:
            sections.append(f"Open-ended questions asked: {open_count}")

        filler_total = speech_markers.get('fillerWordCount')
        top_fillers = speech_markers.get('topFillers') or []
        if filler_total:
            filler_parts = [f"total filler words: {filler_total}"]
            if isinstance(top_fillers, list) and top_fillers:
                top_list = ", ".join(
                    f"{item.get('word')} ({item.get('count')})"
                    for item in top_fillers if item
                )
                if top_list:
                    filler_parts.append(f"top fillers: {top_list}")
            sections.append("Speech fillers: " + "; ".join(filler_parts))

        question_examples = speech_markers.get('questionExamples') or []
        if question_examples:
            formatted_examples = "; ".join(question_examples[:3])
            sections.append("Sample open-ended questions: " + formatted_examples)

    sections.append("Contextual notes: Provide strengths, concerns, and one actionable tip.")

    return "\n\n".join(sections)

def _localize_metrics_summary_fi(metrics_summary: str) -> str:
    if not isinstance(metrics_summary, str) or not metrics_summary:
        return metrics_summary

    replacements = [
        ("Contextual notes: Provide strengths, concerns, and one actionable tip.", "Kontekstihuomio: nosta esiin vahvuudet, huomiot ja yksi käytännön vinkki."),
        ("Brow positions (neutral/raised/lowered %)", "Kulmien asento (neutraali/koholla/alhaalla %)"),
        ("Eye contact (gaze center)", "Katsekontakti (katse keskellä)"),
        ("Gaze distribution", "Katseen suunnan jakauma"),
        ("Emotion distribution", "Ilmeiden jakauma"),
        ("Head pose distribution", "Pään asennon jakauma"),
        ("Speaking time vs call duration", "Puheaika suhteessa puhelun kestoon"),
        ("Call duration (seconds)", "Puhelun kesto (sekuntia)"),
        ("Transcript excerpt", "Ote litteroinnista"),
        ("Open-ended questions asked", "Avoimia kysymyksiä esitetty"),
        ("Sample open-ended questions", "Esimerkkejä avoimista kysymyksistä"),
        ("Speech fillers", "Puheen täytesanat"),
        ("total filler words", "täytesanoja yhteensä"),
        ("top fillers", "yleisimmät täytesanat"),
        ("Shoulders visible", "Hartiat näkyvissä"),
        ("Head shakes", "Pään pudistukset"),
        ("Still frames", "Kuvaruudut joissa pää paikallaan"),
        ("Nods", "Nyökkäykset"),
    ]

    # Keep word-level replacements small and explicit to avoid broader side effects.
    word_replacements = [
        ("Forward", "Eteen"),
        ("Center", "Keskellä"),
        ("Left", "Vasen"),
        ("Right", "Oikea"),
        ("Up", "Ylös"),
        ("Down", "Alas"),
        ("neutral", "neutraali"),
        ("happy", "ilo"),
        ("sad", "suru"),
        ("angry", "viha"),
        ("fear", "pelko"),
        ("surprise", "yllätys"),
        ("disgust", "inho"),
        ("frames", "kuvaruudut"),
    ]

    def localize_section(section_text: str) -> str:
        localized_section = section_text
        for source_text, target_text in replacements:
            localized_section = localized_section.replace(source_text, target_text)
        for source_text, target_text in word_replacements:
            localized_section = re.sub(rf"(?<!\w){re.escape(source_text)}(?!\w)", target_text, localized_section)
        return localized_section

    localized_sections = []
    for section in metrics_summary.split("\n\n"):
        if section.startswith("Transcript excerpt:\n"):
            excerpt = section.removeprefix("Transcript excerpt:\n")
            localized_sections.append("Ote litteroinnista:\n" + excerpt)
            continue
        if section.startswith("Sample open-ended questions: "):
            examples = section.removeprefix("Sample open-ended questions: ")
            localized_sections.append("Esimerkkejä avoimista kysymyksistä: " + examples)
            continue
        localized_sections.append(localize_section(section))

    return "\n\n".join(localized_sections)

def _resolve_llm_output_language(locale):
    return 'Finnish' if locale == 'fi' else 'English'

def build_llm_prompt(features, locale='en'):
    metrics_block = build_llm_metrics_summary(features)
    if locale == 'fi':
        metrics_block = _localize_metrics_summary_fi(metrics_block)
    output_language = _resolve_llm_output_language(locale)
    language_style_note = (
        "Use natural Finnish and avoid awkward literal translations of metric terms. "
        "Prefer plain, idiomatic Finnish coaching language."
        if locale == 'fi' else
        "Use natural, plain English coaching language."
    )
    return (
        "You are an expert coach helping a healthcare student improve their telehealth presence. "
        "Given the metrics, write warm, plain-language observations aimed at the student (use 'you'/'your'). "
        "Return a single valid JSON object with exactly these keys:\n"
        "- headline: one encouraging sentence (max 80 characters) addressed to the student.\n"
        "- analysis: 1-2 conversational sentences describing the most important signals supported by the metrics; mention the specific metric names or percentages when needed.\n"
        "- recommendations: an array with up to 2 practical tips (<90 characters each) or an empty array if nothing actionable stands out.\n"
        "Every word you produce must live inside those JSON string values—never add standalone strings, comments, or code fences.\n"
        f"Write all JSON string values strictly in {output_language}. "
        "Use a warm, supportive tone, highlight at most one strength and one opportunity (skip the opportunity if data is neutral), "
        "and base every statement strictly on the provided metrics. Do not make any assumptions about the student's personality or behavior. "
        f"{language_style_note}"
        f"\n\nMetrics:\n{metrics_block}"
    )

def _build_nonverbal_analysis_system_prompt(locale='en'):
    output_language = _resolve_llm_output_language(locale)
    language_style_note = (
        "Use natural Finnish and avoid awkward literal translations of metric terms."
        if locale == 'fi' else
        "Use natural, plain English."
    )
    return (
        "You translate quantified metrics into warm, concise coaching tips "
        "for a healthcare student. Address the student directly, use natural language, "
        "and reference the concrete metrics (gaze %, nod count, etc.). "
        "CRITICAL: Base ALL recommendations strictly on the detected data provided. "
        "Do NOT hallucinate or invent behaviors that were not measured. "
        "Only mention metrics that are explicitly included in the data. "
        f"Write your response strictly in {output_language}. "
        f"{language_style_note} "
        "Return one valid JSON object only with the keys headline, analysis, recommendations; "
        "do not emit standalone strings, Markdown, or explanations."
    )

def _parse_llm_analysis_response(raw_content: str, locale: str = 'en'):
    raw = (raw_content or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`").strip()
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()

    parsed = {}
    try:
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            parsed = loaded
    except json.JSONDecodeError:
        first = raw.find("{")
        last = raw.rfind("}")
        if first != -1 and last != -1 and last > first:
            try:
                loaded = json.loads(raw[first:last+1])
                if isinstance(loaded, dict):
                    parsed = loaded
            except json.JSONDecodeError:
                parsed = {}

    headline = parsed.get("headline", "")
    if not isinstance(headline, str) or not headline.strip():
        headline = "Viestinnän yhteenveto" if locale == 'fi' else "Telehealth Skill Snapshot"
    else:
        headline = headline.strip()

    analysis_text = parsed.get("analysis", "")
    if not isinstance(analysis_text, str) or not analysis_text.strip():
        analysis_text = (
            "Vuorovaikutusmittarit analysoitiin."
            if locale == 'fi'
            else "Your nonverbal metrics were processed."
        )
    else:
        analysis_text = analysis_text.strip()

    recommendations = parsed.get("recommendations", [])
    if isinstance(recommendations, list):
        recommendations = [
            item.strip() for item in recommendations
            if isinstance(item, str) and item.strip()
        ][:2]
    elif isinstance(recommendations, str) and recommendations.strip():
        recommendations = [recommendations.strip()][:2]
    else:
        recommendations = []

    return {
        "headline": headline,
        "analysis": analysis_text,
        "recommendations": recommendations
    }

def analyze_nonverbal_with_llm(features, locale='en'):
    prompt = build_llm_prompt(features, locale=locale)
    system_prompt = _build_nonverbal_analysis_system_prompt(locale=locale)
    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "options": {
                    "num_predict": 300,
                    "temperature": 0.3,
                    "num_ctx": 2048,
                },
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            },
            timeout=OLLAMA_TIMEOUT
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Ollama request failed: {exc}") from exc

    if response.status_code != 200:
        raise RuntimeError(f"Ollama responded with status {response.status_code}: {response.text}")

    data = response.json()
    content = ""
    if isinstance(data, dict):
        message = data.get('message') or {}
        content = message.get('content') or data.get('response') or ''

    content = (content or "").strip()
    if not content:
        raise RuntimeError("Received empty response from Ollama.")

    return _parse_llm_analysis_response(content, locale=locale)

def chat_with_llm(features, conversation_history, locale='en'):
    """Handle conversational chat while maintaining context of analysis features."""
    
    metrics_summary = build_llm_metrics_summary(features)
    if locale == 'fi':
        metrics_summary = _localize_metrics_summary_fi(metrics_summary)
    output_language = _resolve_llm_output_language(locale)
    
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful coaching assistant for a healthcare student. "
                "You have access to their telehealth session analysis with the following metrics:\n\n"
                f"{metrics_summary}\n\n"
                "Answer students follow up questions about their performance and offer actionable advice. "
                "Be warm, supportive, specific, and concise. "
                f"Keep replies short: max {LLM_CHAT_MAX_SENTENCES} sentences and under {LLM_CHAT_MAX_RESPONSE_CHARS} characters. "
                "Reference the concrete metrics when relevant. Use natural, conversational language. "
                "CRITICAL: Base ALL responses strictly on the detected data provided. "
                "Do NOT hallucinate or invent behaviors that were not measured. "
                "Only discuss metrics that are explicitly included in the data. "
                f"Reply strictly in {output_language}."
            )
        }
    ]

    messages.extend(conversation_history)

    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "options": {
                    "num_predict": LLM_CHAT_NUM_PREDICT,
                    "temperature": 0.5,
                    "num_ctx": 4096,
                },
                "messages": messages
            },
            timeout=OLLAMA_TIMEOUT
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Ollama request failed: {exc}") from exc

    if response.status_code != 200:
        raise RuntimeError(f"Ollama responded with status {response.status_code}: {response.text}")

    data = response.json()
    if isinstance(data, dict):
        message = data.get('message') or {}
        content = message.get('content') or data.get('response') or ''
        return clamp_llm_chat_response(content)

    return "I apologize, but I couldn't generate a response."

def clamp_llm_chat_response(content):
    if not isinstance(content, str):
        return "I could not generate a response."

    normalized = " ".join(content.strip().split())
    if not normalized:
        return "I could not generate a response."

    sentence_parts = re.split(r'(?<=[.!?])\s+', normalized)
    sentence_parts = [part.strip() for part in sentence_parts if part.strip()]
    if sentence_parts:
        normalized = " ".join(sentence_parts[:LLM_CHAT_MAX_SENTENCES])

    if len(normalized) <= LLM_CHAT_MAX_RESPONSE_CHARS:
        return normalized

    trimmed = normalized[:LLM_CHAT_MAX_RESPONSE_CHARS].rstrip()
    last_space = trimmed.rfind(' ')
    if last_space >= int(LLM_CHAT_MAX_RESPONSE_CHARS * 0.6):
        trimmed = trimmed[:last_space]

    trimmed = trimmed.rstrip(' ,;:')
    if not trimmed.endswith(('.', '!', '?')):
        trimmed += '...'
    return trimmed

def infer_audio_format(filename=None, mime_type=None):
    mime = (mime_type or '').lower().split(';', 1)[0].strip()
    if mime in {'audio/webm', 'video/webm'}:
        return 'webm'
    if mime in {'audio/wav', 'audio/x-wav'}:
        return 'wav'
    if mime in {'audio/mpeg', 'audio/mp3'}:
        return 'mp3'
    if mime in {'audio/mp4', 'audio/x-m4a', 'audio/aac'}:
        return 'mp4'
    if mime in {'audio/ogg', 'audio/oga'}:
        return 'ogg'

    ext = os.path.splitext((filename or '').lower())[1]
    ext_to_format = {
        '.webm': 'webm',
        '.wav': 'wav',
        '.mp3': 'mp3',
        '.m4a': 'mp4',
        '.mp4': 'mp4',
        '.aac': 'aac',
        '.ogg': 'ogg',
        '.oga': 'ogg',
    }
    return ext_to_format.get(ext)

def convert_to_wav(audio_contents, source_format=None):
    if isinstance(audio_contents, str):
        if source_format:
            audio = AudioSegment.from_file(audio_contents, format=source_format)
        else:
            audio = AudioSegment.from_file(audio_contents)
    elif isinstance(audio_contents, bytes):
        if source_format:
            audio = AudioSegment.from_file(io.BytesIO(audio_contents), format=source_format)
        else:
            audio = AudioSegment.from_file(io.BytesIO(audio_contents))
    else:
        raise ValueError("audio_contents must be a file path or bytes")
    
    # Set the sample rate to the desired value
    #audio = audio.set_frame_rate(48000)
    #audio = audio.set_sample_width(3)

    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_wav_file:
        temp_wav_path = temp_wav_file.name
    audio.export(temp_wav_path, format='wav')
    return temp_wav_path

def detect_nonsilent_ranges(audio):
    if not isinstance(audio, AudioSegment) or len(audio) == 0:
        return []
    if audio.dBFS == float('-inf'):
        return []

    return detect_nonsilent(
        audio,
        min_silence_len=AUDIO_MIN_SILENCE_LEN_MS,
        silence_thresh=AUDIO_SILENCE_THRESHOLD_DB
    )

def estimate_speech_activity_ms(audio, ranges=None):
    if not isinstance(audio, AudioSegment) or len(audio) == 0:
        return 0
    if audio.dBFS == float('-inf'):
        return 0

    if ranges is None:
        ranges = detect_nonsilent_ranges(audio)
    if not ranges:
        return 0

    total_speech_ms = 0
    for start_ms, end_ms in ranges:
        duration_ms = max(0, end_ms - start_ms)
        if duration_ms >= AUDIO_MIN_SPEECH_CHUNK_MS:
            total_speech_ms += duration_ms
    return total_speech_ms

def calculate_speech_duration_seconds(audio, ranges=None):
    full_duration_seconds = len(audio) / 1000.0
    speech_ms = estimate_speech_activity_ms(audio, ranges)
    return min(speech_ms / 1000.0, full_duration_seconds)

def build_compact_audio_for_asr(audio, ranges=None):
    if not isinstance(audio, AudioSegment) or len(audio) == 0:
        return None, 0

    if ranges is None:
        ranges = detect_nonsilent_ranges(audio)
    if not ranges:
        return None, 0

    compact_audio = AudioSegment.silent(duration=0, frame_rate=audio.frame_rate)
    compact_ms = 0
    for start_ms, end_ms in ranges:
        duration_ms = max(0, end_ms - start_ms)
        if duration_ms < AUDIO_MIN_SPEECH_CHUNK_MS:
            continue
        compact_audio += audio[start_ms:end_ms]
        compact_ms += duration_ms

    if compact_ms <= 0 or len(compact_audio) == 0:
        return None, 0
    return compact_audio, compact_ms

def audio_to_whisper_samples(audio_input):
    if isinstance(audio_input, AudioSegment):
        audio = audio_input
    elif isinstance(audio_input, str):
        audio = AudioSegment.from_file(audio_input)
    else:
        raise ValueError("audio_input must be AudioSegment or file path")

    audio = audio.set_frame_rate(WHISPER_SAMPLE_RATE).set_channels(1)
    raw_samples = np.array(audio.get_array_of_samples(), dtype=np.float32)
    if raw_samples.size == 0:
        return raw_samples

    sample_width = max(1, int(audio.sample_width))
    if sample_width == 1:
        # 8-bit PCM is typically unsigned.
        raw_samples = (raw_samples - 128.0) / 128.0
    else:
        scale = float(1 << (8 * sample_width - 1))
        raw_samples = raw_samples / scale

    return np.clip(raw_samples, -1.0, 1.0)

def analyze_audio(audio_contents, client_id, source_format=None):
    temp_wav_file = None
    
    try:
        temp_wav_file = convert_to_wav(audio_contents, source_format=source_format)
        full_audio = AudioSegment.from_file(temp_wav_file)
        total_duration_ms = len(full_audio)
        nonsilent_ranges = detect_nonsilent_ranges(full_audio)
        speech_ms = estimate_speech_activity_ms(full_audio, nonsilent_ranges)
        speech_ratio = (speech_ms / total_duration_ms) if total_duration_ms > 0 else 0.0

        if speech_ms < AUDIO_MIN_SPEECH_MS:
            logger.info(
                f"Skipping Whisper for client {client_id}: low speech activity "
                f"(speech_ms={speech_ms}, speech_ratio={speech_ratio:.3f})"
            )
            return {
                'text': '',
                'speaking_time': int(round(speech_ms / 1000.0)),
                'client_id': client_id
            }

        whisper_input_duration_ms = total_duration_ms
        whisper_input_audio = full_audio
        if total_duration_ms >= AUDIO_COMPACT_MIN_TOTAL_MS:
            compact_audio, compact_ms = build_compact_audio_for_asr(full_audio, nonsilent_ranges)
            saved_ms = total_duration_ms - compact_ms
            if compact_audio is not None and saved_ms >= AUDIO_COMPACT_MIN_SAVINGS_MS:
                whisper_input_duration_ms = compact_ms
                whisper_input_audio = compact_audio
                logger.info(
                    f"Using compact audio for client {client_id}: "
                    f"{compact_ms}ms speech out of {total_duration_ms}ms total."
                )

        def run_transcribe(audio_input, use_timestamps=False):
            with whisper_lock:
                whisper_samples = audio_to_whisper_samples(audio_input)
                if whisper_samples.size == 0:
                    return {'text': ''}

                processor_inputs = whisper_processor(
                    whisper_samples,
                    sampling_rate=WHISPER_SAMPLE_RATE,
                    return_attention_mask=True,
                    return_tensors='pt'
                )
                input_features = processor_inputs.get('input_features')
                if input_features is None:
                    raise RuntimeError("Whisper processor did not return input_features.")

                input_features = input_features.to(
                    device=whisper_model.device,
                    dtype=whisper_model.dtype
                )

                generation_kwargs = {
                    'return_timestamps': bool(use_timestamps),
                    'do_sample': False,
                    'temperature': 0.0
                }

                attention_mask = processor_inputs.get('attention_mask')
                if attention_mask is not None:
                    generation_kwargs['attention_mask'] = attention_mask.to(whisper_model.device)

                with torch.inference_mode():
                    generated_ids = whisper_model.generate(
                        input_features=input_features,
                        **generation_kwargs
                    )

                text = whisper_processor.batch_decode(
                    generated_ids,
                    skip_special_tokens=True
                )[0].strip()
                return {'text': text}

        def run_chunked_transcribe(chunk_audio, chunk_ms):
            chunk_texts = []
            total_ms = len(chunk_audio)
            chunk_count = (total_ms + chunk_ms - 1) // chunk_ms if chunk_ms > 0 else 0
            for chunk_idx, start_ms in enumerate(range(0, total_ms, chunk_ms), start=1):
                end_ms = min(start_ms + chunk_ms, total_ms)
                segment = chunk_audio[start_ms:end_ms]
                if len(segment) < AUDIO_MIN_SPEECH_CHUNK_MS:
                    continue
                logger.info(
                    f"Whisper chunk {chunk_idx}/{chunk_count} for client {client_id} "
                    f"({len(segment)}ms)"
                )
                chunk_result = run_transcribe(segment, use_timestamps=False)
                chunk_text = (chunk_result.get('text') or '').strip()
                if chunk_text:
                    chunk_texts.append(chunk_text)
            return " ".join(chunk_texts).strip()

        if whisper_input_duration_ms > WHISPER_LONGFORM_THRESHOLD_MS:
            logger.info(
                f"Using chunked Whisper for long audio from client {client_id}: "
                f"{whisper_input_duration_ms}ms"
            )
            text = run_chunked_transcribe(whisper_input_audio, ASR_CHUNK_FALLBACK_MS)
        else:
            whisper_result = run_transcribe(whisper_input_audio, use_timestamps=False)
            text = (whisper_result.get('text') or '').strip()

        for char in ['"', '“', '”', '„', '«', '»']:
            text = text.replace(char, '')
        text = re.sub(r'<\|[^|>]+?\|>', '', text).strip()
        
        speaking_time_seconds = calculate_speech_duration_seconds(full_audio, nonsilent_ranges)
        speaking_time = int(round(speaking_time_seconds))

        if text and (
            speaking_time_seconds <= 0 or
            (speaking_time_seconds < AUDIO_LOW_SPEECH_SECONDS and len(text) <= AUDIO_LOW_SPEECH_MAX_TEXT_CHARS)
        ):
            logger.info(
                f"Discarding likely hallucinated Whisper text for client {client_id} "
                f"(chars={len(text)}, speaking_time={speaking_time_seconds:.2f}s)"
            )
            text = ''
        
        logger.info(f"Processed audio for client {client_id}: {len(text)} characters of text")
        
        return {'text': text, 'speaking_time': speaking_time, 'client_id': client_id}
    except ValueError as ve:
        logger.error(f"Invalid audio format for client {client_id}: {str(ve)}")
        return {'error': str(ve), 'text': '', 'speaking_time': 0, 'client_id': client_id}
    except Exception as e:
        logger.error(f"Unexpected error in analyze_audio for client {client_id}: {str(e)}")
        return {'error': str(e), 'text': '', 'speaking_time': 0, 'client_id': client_id}
    finally:
        # This ensures the file is always deleted, even if an error occurs
        if temp_wav_file and os.path.exists(temp_wav_file):
            try:
                os.remove(temp_wav_file)
            except Exception as e:
                logger.error(f"Error removing temporary file for client {client_id}: {str(e)}")
@app.post('/llm-analysis')
def llm_analysis(payload: Optional[dict] = Body(default=None)):
    try:
        request_payload = LlmAnalysisRequestPayload.model_validate(payload or {})
    except ValidationError:
        return JSONResponse(
            content={"error": "Invalid payload. Expected JSON with a typed 'features' object."},
            status_code=400
        )

    features = request_payload.features.model_dump()
    locale = request_payload.locale
    try:
        analysis = analyze_nonverbal_with_llm(features, locale=locale)
        return JSONResponse(content={"analysis": analysis}, status_code=200)
    except RuntimeError as err:
        logger.error(f"Ollama analysis failed: {err}")
        return JSONResponse(content={"error": str(err)}, status_code=502)
    except Exception as exc:
        logger.exception("Unexpected error while running LLM analysis")
        return JSONResponse(content={"error": "Failed to run LLM analysis."}, status_code=500)

@app.post('/llm-chat')
def llm_chat(payload: Optional[dict] = Body(default=None)):
    try:
        request_payload = LlmChatRequestPayload.model_validate(payload or {})
    except ValidationError:
        return JSONResponse(
            content={"error": "Invalid payload. Expected typed 'features' and 'conversation' values."},
            status_code=400
        )

    features = request_payload.features.model_dump()
    conversation = [item.model_dump() for item in request_payload.conversation]
    locale = request_payload.locale
    try:
        conversation = validate_llm_chat_conversation(conversation)
    except ValueError as err:
        return JSONResponse(content={"error": str(err)}, status_code=400)

    try:
        response = chat_with_llm(features, conversation, locale=locale)
        return JSONResponse(content={"response": response}, status_code=200)
    except RuntimeError as err:
        logger.error(f"Ollama chat failed: {err}")
        return JSONResponse(content={"error": str(err)}, status_code=502)
    except Exception as exc:
        logger.exception("Unexpected error in LLM chat")
        return JSONResponse(content={"error": "Failed to process chat message."}, status_code=500)

def validate_llm_chat_conversation(conversation):
    if len(conversation) > LLM_CHAT_MAX_ITEMS:
        raise ValueError(
            f"Invalid payload. 'conversation' supports up to {LLM_CHAT_MAX_ITEMS} items."
        )

    normalized = []
    for index, item in enumerate(conversation):
        if not isinstance(item, dict):
            raise ValueError(f"Invalid payload. conversation[{index}] must be an object.")

        role = item.get('role')
        if role not in {'user', 'assistant'}:
            raise ValueError(
                f"Invalid payload. conversation[{index}].role must be 'user' or 'assistant'."
            )

        content = item.get('content')
        if not isinstance(content, str):
            raise ValueError(f"Invalid payload. conversation[{index}].content must be a string.")

        content = content.strip()
        if not content:
            raise ValueError(f"Invalid payload. conversation[{index}].content cannot be empty.")

        if len(content) > LLM_CHAT_MAX_CONTENT_LENGTH:
            raise ValueError(
                f"Invalid payload. conversation[{index}].content exceeds "
                f"{LLM_CHAT_MAX_CONTENT_LENGTH} characters."
            )

        normalized.append({
            "role": role,
            "content": content
        })

    return normalized

def clamp_patient_response_to_symptoms(content):
    if not isinstance(content, str):
        return PATIENT_FALLBACK_REPLY

    normalized = " ".join(content.strip().split())
    if not normalized:
        return PATIENT_FALLBACK_REPLY

    parts = re.split(r'(?<=[.!?])\s+', normalized)
    parts = [part.strip() for part in parts if part.strip()]
    if parts:
        selected_parts = []
        for part in parts:
            if len(selected_parts) >= PATIENT_REPLY_MAX_SENTENCES:
                break
            candidate = part if not selected_parts else f"{' '.join(selected_parts)} {part}"
            if len(candidate) <= PATIENT_REPLY_MAX_CHARS:
                selected_parts.append(part)
            elif not selected_parts:
                truncated = part[:PATIENT_REPLY_MAX_CHARS].rstrip()
                last_space = truncated.rfind(' ')
                if last_space >= int(PATIENT_REPLY_MAX_CHARS * 0.6):
                    truncated = truncated[:last_space]
                truncated = truncated.rstrip(' ,;:')
                if truncated and not truncated.endswith(('.', '!', '?')):
                    truncated += '.'
                selected_parts.append(truncated)
                break
            else:
                break
        normalized = " ".join(selected_parts) if selected_parts else parts[0][:PATIENT_REPLY_MAX_CHARS].strip()

    normalized = normalized.rstrip(' ,;:')
    if normalized and not normalized.endswith(('.', '!', '?')):
        normalized += '.'

    lower_text = normalized.lower()
    forbidden_role_patterns = (
        r"\bolen\s+(lääkäri|tohtori|hoitaja)\b",
        r"\btoimin\s+(lääkärinä|tohtorina|hoitajana)\b",
        r"\bi am a (doctor|physician|nurse)\b",
    )
    for pattern in forbidden_role_patterns:
        if re.search(pattern, lower_text):
            return PATIENT_FALLBACK_REPLY

    return normalized

def chat_with_patient(conversation_history):
    profile_prompt = (
        "Olet potilas lääkärin etävastaanotolla. Vastaa suomeksi luonnollisesti ja pysy potilaan roolissa. "
        "Et ole lääkäri etkä anna diagnoosia tai hoito-ohjeita. "
        "Perustiedot: 34-vuotias, päänsärkyä ja huimausta 4 päivän ajan, oireet eivät ole helpottaneet. "
        "Vastaa 1-2 lyhyellä virkkeellä (enintään noin 20 sanaa yhteensä): "
        "1) suora vastaus kysymykseen, "
        "2) yksi konkreettinen lisätieto (kesto, voimakkuus tai arkeen vaikutus). "
        "Kerro tietoa vaiheittain, älä kaikkea kerralla. "
        "Jos kysymys on epäselvä, pyydä täsmennystä yhdellä lyhyellä kysymyksellä. "
        "Älä keksi ristiriitaista taustatarinaa."
    )

    filtered_history = []
    if isinstance(conversation_history, list):
        for item in conversation_history[-12:]:
            if not isinstance(item, dict):
                continue
            role = item.get('role')
            content = item.get('content')
            if role in {'user', 'assistant'} and isinstance(content, str) and content.strip():
                filtered_history.append({"role": role, "content": content.strip()})

    messages = [
        {
            "role": "system",
            "content": profile_prompt
        }
    ]
    messages.extend(filtered_history)

    options = {
        "num_predict": 70,
        "temperature": 0.25,
        "num_ctx": 2048,
        "top_k": 40,
        "top_p": 0.90,
        "repeat_penalty": 1.10,
    }
    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/chat",
            json={
                "model": PATIENT_OLLAMA_MODEL,
                "stream": False,
                "options": options,
                "messages": messages
            },
            timeout=OLLAMA_TIMEOUT
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Ollama request failed for model '{PATIENT_OLLAMA_MODEL}': {exc}") from exc

    if response.status_code != 200:
        raise RuntimeError(
            f"Ollama model '{PATIENT_OLLAMA_MODEL}' responded with status {response.status_code}: {response.text}"
        )

    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Ollama model '{PATIENT_OLLAMA_MODEL}' returned invalid JSON.") from exc

    content = ""
    if isinstance(data, dict):
        message = data.get('message') or {}
        content = (message.get('content') or data.get('response') or '').strip()

    if content:
        return clamp_patient_response_to_symptoms(content)

    raise RuntimeError(f"Ollama model '{PATIENT_OLLAMA_MODEL}' returned empty reply after cleanup.")

@app.post('/llm-patient-chat')
def llm_patient_chat(payload: Optional[dict] = Body(default=None)):
    payload = payload or {}
    if not isinstance(payload, dict):
        payload = {}
    conversation = payload.get('conversation', [])

    if not isinstance(conversation, list):
        return JSONResponse(content={"error": "Invalid payload. Expected 'conversation' to be a list."}, status_code=400)

    try:
        response = chat_with_patient(conversation)
        return JSONResponse(content={"response": response}, status_code=200)
    except RuntimeError as err:
        logger.error(f"Ollama patient chat failed: {err}")
        return JSONResponse(content={"error": str(err)}, status_code=502)
    except Exception as exc:
        logger.exception("Unexpected error in LLM patient chat")
        return JSONResponse(content={"error": "Failed to process patient chat message."}, status_code=500)

def synthesize_piper_audio(text):
    if not isinstance(text, str):
        raise ValueError("Text must be a string.")

    clean_text = text.strip()
    if not clean_text:
        raise ValueError("Text is empty.")

    if len(clean_text) > PATIENT_PIPER_MAX_CHARS:
        clean_text = clean_text[:PATIENT_PIPER_MAX_CHARS]

    if not PATIENT_PIPER_MODEL_PATH:
        raise RuntimeError("PATIENT_PIPER_MODEL_PATH is not configured.")

    temp_output = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
    temp_output_path = temp_output.name
    temp_output.close()

    command = [
        PATIENT_PIPER_BIN,
        '--model', PATIENT_PIPER_MODEL_PATH,
        '--output_file', temp_output_path
    ]

    if PATIENT_PIPER_CONFIG_PATH:
        command.extend(['--config', PATIENT_PIPER_CONFIG_PATH])

    if PATIENT_PIPER_SPEAKER_ID:
        command.extend(['--speaker', PATIENT_PIPER_SPEAKER_ID])

    try:
        subprocess.run(
            command,
            input=clean_text,
            text=True,
            check=True,
            capture_output=True,
            timeout=PATIENT_PIPER_TIMEOUT_SECONDS
        )
        with open(temp_output_path, 'rb') as audio_file:
            return audio_file.read()
    except FileNotFoundError as exc:
        raise RuntimeError(f"Piper binary '{PATIENT_PIPER_BIN}' not found.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"Piper synthesis timed out after {PATIENT_PIPER_TIMEOUT_SECONDS}s."
        ) from exc
    except subprocess.CalledProcessError as exc:
        details = (exc.stderr or exc.stdout or str(exc)).strip()
        raise RuntimeError(f"Piper synthesis failed: {details}") from exc
    finally:
        if os.path.exists(temp_output_path):
            try:
                os.remove(temp_output_path)
            except Exception:
                pass

@app.post('/piper-tts')
def piper_tts(payload: Optional[dict] = Body(default=None)):
    payload = payload or {}
    if not isinstance(payload, dict):
        payload = {}
    text = payload.get('text')

    if not isinstance(text, str):
        return JSONResponse(content={"error": "Invalid payload. Expected 'text' string."}, status_code=400)

    try:
        audio_bytes = synthesize_piper_audio(text)
        return JSONResponse(content={
            "mime": "audio/wav",
            "audio_base64": base64.b64encode(audio_bytes).decode('ascii')
        }, status_code=200)
    except ValueError as err:
        return JSONResponse(content={"error": str(err)}, status_code=400)
    except RuntimeError as err:
        logger.error(f"Piper TTS error: {err}")
        return JSONResponse(content={"error": str(err)}, status_code=500)
    except Exception:
        logger.exception("Unexpected error in piper_tts")
        return JSONResponse(content={"error": "Failed to synthesize patient audio."}, status_code=500)

def head_pose_estimation(face_result, image_shape, client_id):
    texts = []

    head_tracker = get_tracker_for_client(client_id)
    img_h, img_w = image_shape[:2]

    if face_result and face_result.face_landmarks:
        face_landmarks = face_result.face_landmarks[0]
        face_3d = []
        face_2d = []
        face_points = {}

        for idx in FACE_POSE_KEYPOINT_INDICES:
            if idx < len(face_landmarks):
                lm = face_landmarks[idx]
                # Preserve historical mirroring used by the old mp.solutions path.
                x = int((1.0 - lm.x) * img_w)
                y = int(lm.y * img_h)
                face_2d.append([x, y])
                face_3d.append([x, y, lm.z])
                face_points[idx] = (x, y)

        if len(face_2d) >= 6 and len(face_3d) >= 6:
            # Convert numpy arrays
            face_2d_np = np.array(face_2d, dtype=np.float64)
            face_3d_np = np.array(face_3d, dtype=np.float64)

            focal_length = 1 * img_w

            cam_matrix = np.array([ [focal_length, 0, img_w / 2],
                                    [0, focal_length, img_h / 2],
                                    [0, 0, 1]])

            dist_matrix = np.zeros((4, 1), dtype=np.float64)

            # PnP
            success, rot_vec, trans_vec = cv2.solvePnP(face_3d_np, face_2d_np, cam_matrix, dist_matrix)
            if success:
                # Rotational matrix
                rmat, jac = cv2.Rodrigues(rot_vec)

                # Angles
                angles, mtxR, mtxQ, Qx, Qy, Qz = cv2.RQDecomp3x3(rmat)

                # Rotation degrees
                x = angles[0] * 360
                y = angles[1] * 360
                z = angles[2] * 360

                current_time = time.time()
                head_tracker.update_angles(x, y, current_time)

                used_profile_fallback = False
                looking_direction = "Forward"
                if y < HEAD_POSE_YAW_LEFT_THRESHOLD:
                    looking_direction = "Looking Left"
                elif y > HEAD_POSE_YAW_RIGHT_THRESHOLD:
                    looking_direction = "Looking Right"
                elif x < HEAD_POSE_PITCH_DOWN_THRESHOLD:
                    looking_direction = "Looking Down"
                elif x > HEAD_POSE_PITCH_UP_THRESHOLD:
                    looking_direction = "Looking Up"
                else:
                    left_eye = face_points.get(33)
                    right_eye = face_points.get(263)
                    is_profile_view = False
                    if left_eye and right_eye:
                        eye_distance = abs(left_eye[0] - right_eye[0])
                        eye_distance_norm = eye_distance / float(max(img_w, 1))
                        is_profile_view = eye_distance_norm < HEAD_POSE_PROFILE_EYE_DISTANCE_THRESHOLD
                    if is_profile_view and head_tracker.last_looking_direction in ("Looking Left", "Looking Right"):
                        looking_direction = head_tracker.last_looking_direction
                        used_profile_fallback = True

                if looking_direction in ("Looking Left", "Looking Right"):
                    head_tracker.last_looking_direction = looking_direction
                elif looking_direction == "Forward" and not used_profile_fallback:
                    head_tracker.last_looking_direction = "Forward"

                texts.append(looking_direction)
                
                nodding_detected = detect_motion_pattern(
                    head_tracker.angle_history, 
                    NODDING_THRESHOLD, 
                    head_tracker.last_angle_time, 
                    current_time, 
                    NODDING_COOLDOWN
                )
        
                shaking_detected = detect_motion_pattern(
                    head_tracker.y_angle_history, 
                    SHAKING_THRESHOLD, 
                    head_tracker.last_shake_time, 
                    current_time, 
                    SHAKING_COOLDOWN
                )

                if nodding_detected:
                    logger.info(f"Nodding detected for client {client_id}")
                    texts.append("Nodding")
                    head_tracker.set_last_angle_time(current_time)
                    head_tracker.clear_angle_history()
        
                if shaking_detected:
                    logger.info(f"Shaking detected for client {client_id}")
                    texts.append("Shaking")
                    head_tracker.set_last_shake_time(current_time)
                    head_tracker.clear_y_angle_history()
            
    return texts

def detect_motion_pattern(angle_history, threshold, last_detection_time, current_time, cooldown):
    if len(angle_history) < 3 or (current_time - last_detection_time) <= cooldown:
        return False

    recent_history = [
        item for item in angle_history
        if (current_time - item[0]) <= MOTION_HISTORY_WINDOW_SECONDS
    ]
    if len(recent_history) < 3:
        return False

    values = [item[1] for item in recent_history]
    movement_range = max(values) - min(values)
    if movement_range < (threshold * MOTION_RANGE_MULTIPLIER):
        return False

    step_threshold = max(1.5, threshold * MOTION_STEP_MULTIPLIER)
    compressed_directions = []

    for i in range(1, len(values)):
        diff = values[i] - values[i - 1]
        if abs(diff) < step_threshold:
            continue

        direction = 1 if diff > 0 else -1
        if not compressed_directions or direction != compressed_directions[-1]:
            compressed_directions.append(direction)

    if len(compressed_directions) < 2:
        return False

    start_end_gap = abs(values[-1] - values[0])
    if start_end_gap > (movement_range * 0.9) and len(compressed_directions) < 3:
        return False

    return True

def pose_estimation(image_rgb):
    if pose_landmarker is None:
        return "N/A"

    pose_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)

    with pose_landmarker_lock:
        results = pose_landmarker.detect(pose_image)

    if not results.pose_landmarks:
        return "N/A"

    landmarks = results.pose_landmarks[0]
    if len(landmarks) <= POSE_RIGHT_SHOULDER_INDEX:
        return "N/A"

    left_shoulder = landmarks[POSE_LEFT_SHOULDER_INDEX]
    right_shoulder = landmarks[POSE_RIGHT_SHOULDER_INDEX]

    left_visibility = float(getattr(left_shoulder, "visibility", 0.0) or 0.0)
    right_visibility = float(getattr(right_shoulder, "visibility", 0.0) or 0.0)
    if (
        left_visibility > 0.8
        and right_visibility > 0.8
        and 0 < left_shoulder.x < 1
        and 0 < left_shoulder.y < 1
        and 0 < right_shoulder.x < 1
        and 0 < right_shoulder.y < 1
    ):
        return "Visible"
    return "Not visible"

def detect_top_emotion(image):
    try:
        with emotion_detector_lock:
            result = DeepFace.analyze(
                img_path=image,
                actions=["emotion"],
                enforce_detection=False,
                detector_backend="opencv",
                silent=True
            )

        if isinstance(result, list):
            result = result[0] if result else {}

        emotions = result.get("emotion") or {}
        emotion = result.get("dominant_emotion")

        if not emotion and emotions:
            emotion = max(emotions, key=emotions.get)

        if not emotion:
            return None, 0.0

        # Keep score in [0,1] for existing frontend thresholds.
        score = float(emotions.get(emotion, 0.0)) / 100.0
        score = max(0.0, min(score, 1.0))

        if score < EMOTION_CONFIDENCE_THRESHOLD:
            return None, score

        return emotion, score

    except Exception as e:
        logger.warning(f"Emotion detection failed: {str(e)}")
        return None, 0.0

def process_image(file_contents, timestamp, client_id):
    try:
        nparr = np.frombuffer(file_contents, np.uint8)
        
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            logger.error("Failed to decode image")
            return {"error": "Failed to decode image."}, 400
        
        # Detect everything in the image
        emotion, score = detect_top_emotion(img)

        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)

        with face_landmarker_lock:
            landmarker_result = face_landmarker.detect(mp_image)
        gaze_text, brow_text = print_result(landmarker_result)
        head_pose_text = head_pose_estimation(landmarker_result, img.shape, client_id)
        pose_text = pose_estimation(img_rgb)

        # Initialize with default values
        looking_direction = "N/A"
        nodding_status = "N/A"
        shaking_status = "N/A"
        
        if head_pose_text and len(head_pose_text) > 0:
            looking_direction = head_pose_text[0]
            
        # Check for nodding and shaking in the full list
        if "Nodding" in head_pose_text:
            nodding_status = "Nodding"
            
        if "Shaking" in head_pose_text:
            shaking_status = "Shaking"

        data = {
            'timestamp': timestamp,
            'client_id': client_id,
            'emotion': emotion,
            'emotion_score': score,
            'head_pose_looking': looking_direction,
            'head_pose_nodding': nodding_status,
            'head_pose_shaking': shaking_status,
            'gaze': gaze_text,
            'brow': brow_text,
            'shoulders': pose_text
        }
        
        return data, 200

    except Exception as e:
        logger.error(f"Error in process_image: {str(e)}")
        return {"error": "Failed to process image."}, 500

if __name__ == '__main__':
    import uvicorn

    uvicorn.run(
        app,
        host=API_HOST,
        port=API_PORT,
        ssl_certfile=API_SSL_CERT,
        ssl_keyfile=API_SSL_KEY,
    )
