export interface AnalysisDirectionStats {
  counts: Record<string, number>;
  percentages: Record<string, number>;
  total: number;
}

export interface AnalysisNoddingShakingSummary {
  nodCount: number;
  shakeCount: number;
  stillCount: number;
}

export interface AnalysisShoulderVisibilitySummary {
  visibleCount: number;
  notVisibleCount: number;
  visiblePercentage: number;
  notVisiblePercentage: number;
}

export interface AnalysisBrowSummary {
  neutrals: number;
  raised: number;
  lowered: number;
  activity: number;
  totalBrowData: number;
  neutralPercentage: string;
  raisedPercentage: string;
  loweredPercentage: string;
  activityPercentage: string;
}

export interface AnalysisSpeechMarkerTopFiller {
  word: string;
  count: number;
}

export interface AnalysisSpeechMarkerSummary {
  openEndedQuestionCount: number;
  questionExamples: string[];
  fillerWordCount: number;
  topFillers: AnalysisSpeechMarkerTopFiller[];
}

export interface AnalysisPayload {
  emotionCounts: Record<string, number>;
  emotionPercentages: Record<string, number>;
  uniqueEmotionCount: number;
  gazeCenterPercentage: number;
  gazeBreakdown: AnalysisDirectionStats;
  headPoseBreakdown: AnalysisDirectionStats;
  noddingShaking: AnalysisNoddingShakingSummary;
  shoulderVisibility: AnalysisShoulderVisibilitySummary;
  browData: AnalysisBrowSummary;
  speakingTimePercentage: number | null;
  callDuration: number | null;
  transcript: string;
  speechMarkers: AnalysisSpeechMarkerSummary | null;
}
