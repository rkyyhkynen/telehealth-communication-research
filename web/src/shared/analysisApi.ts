export interface AudioAnalysisResult {
  text?: string;
  speaking_time?: number;
  client_id?: string;
  error?: string;
}

export interface AnalysisApiEntry {
  [key: string]: unknown;
  timestamp?: string | number;
  client_id?: string;
  emotion?: string | null;
  emotion_score?: number | null;
  head_pose_looking?: string;
  head_pose_nodding?: string;
  head_pose_shaking?: string;
  gaze?: string;
  brow?: string;
  shoulders?: string;
  duration?: string | number;
  audioResult?: AudioAnalysisResult;
}
