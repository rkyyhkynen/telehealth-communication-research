import type { AnalysisApiEntry } from '../shared/analysisApi';
import type {
    AnalysisBrowSummary,
    AnalysisDirectionStats,
    AnalysisPayload,
    AnalysisSpeechMarkerSummary
} from '../shared/analysisPayload';
const EMOTION_CONFIDENCE_THRESHOLD = 0.8;

const QUESTION_WORDS = [
    'mitä', 'miksi', 'kuinka', 'kuinka paljon', 'kuinka monta', 'kuinka usein', 'milloin',
    'missä', 'mihin', 'mistä', 'minne', 'millä', 'miltä', 'mille', 'kuka', 'ketkä',
    'kenen', 'kenet', 'kenellä', 'kenestä', 'kenelle', 'kumpi', 'kummat', 'kumman',
    'kummalla', 'kummasta', 'kummalle', 'millä tavalla', 'miten', 'mihin tarkoitukseen',
    'paljonko', 'montako', 'millainen', 'millaiset', 'millaista', 'minkälainen',
    'minkälaista', 'minkä', 'minkä vuoksi', 'minkä takia',
    'voitko kertoa', 'voisitko kertoa', 'kerrotko', 'kerro', 'kuvaile'
];

export const FILLER_WORDS = [
    'niinku',
    'öö',
    'ööö',
    'tota',
    'tuota',
    'tavallaan',
    'silleen',
    'kai',
    'niinkö',
    'hmmm'
];

const LEADING_CONVERSATIONAL_TOKENS = new Set([
    'no',
    'nii',
    'niin',
    'hei',
    'terve',
    'moro',
    'moi',
    'mm',
    'hmm',
    'hmmm',
    'joo',
    'okei'
]);

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countFillerOccurrences(text: string, filler: string): number {
    const escaped = escapeRegExp(filler);
    const pattern = new RegExp(`(?<![A-Za-zÅÄÖåäö])${escaped}(?![A-Za-zÅÄÖåäö])`, 'giu');
    return Array.from(text.matchAll(pattern)).length;
}

function normalizeQuestionText(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function startsWithOpenQuestionCue(sentence: string): boolean {
    const normalized = normalizeQuestionText(sentence);
    if (!normalized) {
        return false;
    }

    const tokens = normalized.split(' ').filter(Boolean);
    while (tokens.length > 0 && LEADING_CONVERSATIONAL_TOKENS.has(tokens[0])) {
        tokens.shift();
    }

    if (tokens.length === 0) {
        return false;
    }

    const maxOffset = Math.min(3, tokens.length - 1);
    for (const rawWord of QUESTION_WORDS) {
        const cue = normalizeQuestionText(rawWord);
        if (!cue) {
            continue;
        }

        for (let offset = 0; offset <= maxOffset; offset++) {
            const sentenceFromOffset = tokens.slice(offset).join(' ');
            if (sentenceFromOffset === cue || sentenceFromOffset.startsWith(`${cue} `)) {
                return true;
            }
        }
    }

    return false;
}

type RawEntry = AnalysisApiEntry;
type TimelinePoint = { x: Date; y: number | null };
type DirectionStats = AnalysisDirectionStats;

type EmotionSegment = {
    emotion: string;
    startTime: number;
    endTime: number;
    scores: number[];
    averageScore: number;
    duration: number;
};

type BrowSummary = AnalysisBrowSummary;
type SpeechMarkerSummary = AnalysisSpeechMarkerSummary;

export const DataProcessor = {
    filteredData: [] as RawEntry[],
    frameData: [] as RawEntry[],
    audioEntries: [] as RawEntry[],
    validEmotionData: [] as RawEntry[],
    emotionCounts: {} as Record<string, number>,

    init(rawData: unknown): boolean {
        try {
            const inputData = Array.isArray(rawData) ? (rawData as unknown[]) : [];
            this.filteredData = this.filterValidData(inputData);
            this.frameData = this.filteredData
                .filter(item => this.isFrameEntry(item))
                .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
            this.audioEntries = this.filteredData.filter(item => this.isAudioEntry(item));
            this.validEmotionData = this.filterValidEmotions(this.frameData);
            this.emotionCounts = this.countEmotions(this.validEmotionData);
            return true;
        } catch (error) {
            console.error('Error initializing data:', error);
            return false;
        }
    },

    filterValidData(data: unknown[]): RawEntry[] {
        return data.filter(item => item !== undefined && item !== null && typeof item === 'object') as RawEntry[];
    },

    isFrameEntry(item: RawEntry): boolean {
        const timestamp = Number(item.timestamp);
        if (!Number.isFinite(timestamp)) {
            return false;
        }

        return (
            Object.prototype.hasOwnProperty.call(item, 'gaze')
            || Object.prototype.hasOwnProperty.call(item, 'head_pose_looking')
            || Object.prototype.hasOwnProperty.call(item, 'emotion')
            || Object.prototype.hasOwnProperty.call(item, 'shoulders')
            || Object.prototype.hasOwnProperty.call(item, 'brow')
        );
    },

    isAudioEntry(item: RawEntry): boolean {
        return Boolean(item && item.audioResult && typeof item.audioResult === 'object');
    },

    filterValidEmotions(data: RawEntry[]): RawEntry[] {
        return data.filter(item => (
            item.emotion !== null
            && item.emotion !== undefined
            && item.emotion !== 'unknown'
            && Number(item.emotion_score) >= EMOTION_CONFIDENCE_THRESHOLD
        ));
    },

    countEmotions(data: RawEntry[]): Record<string, number> {
        return data.reduce<Record<string, number>>((acc, item) => {
            const emotion = item.emotion;
            if (typeof emotion === 'string' && emotion) {
                acc[emotion] = (acc[emotion] || 0) + 1;
            }
            return acc;
        }, {});
    },

    getEmotionTimelineSegments(): EmotionSegment[] {
        if (!this.validEmotionData || this.validEmotionData.length === 0) {
            return [];
        }

        const sortedData = [...this.validEmotionData].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

        const segments: EmotionSegment[] = [];
        let currentSegment: EmotionSegment | null = null;

        sortedData.forEach(item => {
            const emotion = String(item.emotion || 'unknown');
            const timestamp = Number(item.timestamp) || 0;
            const emotionScore = Number(item.emotion_score) || 0;

            if (!currentSegment || currentSegment.emotion !== emotion) {
                if (currentSegment) {
                    segments.push(currentSegment);
                }
                currentSegment = {
                    emotion,
                    startTime: timestamp,
                    endTime: timestamp,
                    scores: [emotionScore],
                    averageScore: 0,
                    duration: 0
                };
            } else {
                currentSegment.endTime = timestamp;
                currentSegment.scores.push(emotionScore);
            }
        });

        if (currentSegment) {
            segments.push(currentSegment);
        }

        segments.forEach(segment => {
            segment.averageScore = segment.scores.reduce((a, b) => a + b, 0) / segment.scores.length;
            segment.duration = segment.endTime - segment.startTime;
        });

        return segments;
    },

    getUniqueEmotionCount(): number {
        const uniqueEmotions = new Set<string>();
        this.validEmotionData.forEach(item => {
            if (typeof item.emotion === 'string') {
                uniqueEmotions.add(item.emotion);
            }
        });
        return uniqueEmotions.size;
    },

    getSpeakingTimePercentage(): number | null {
        const audioData = this.audioEntries.find(item => (
            item.audioResult?.speaking_time !== undefined
            && item.duration !== undefined
        ));

        if (audioData) {
            const speakingTime = Number(audioData.audioResult?.speaking_time);
            const fullDuration = parseFloat(String(audioData.duration));
            if (!Number.isFinite(speakingTime) || !Number.isFinite(fullDuration) || fullDuration <= 0) {
                return null;
            }
            const speakingPercentage = Math.round((speakingTime / fullDuration) * 100);
            return Math.max(0, Math.min(100, speakingPercentage));
        }
        return null;
    },

    getShoulderVisibilityData(): {
        visibleCount: number;
        notVisibleCount: number;
        visiblePercentage: number;
        notVisiblePercentage: number;
    } {
        let visibleCount = 0;
        let notVisibleCount = 0;

        this.frameData.forEach(item => {
            if (item.shoulders === 'Visible') {
                visibleCount++;
            } else if (item.shoulders === 'Not visible') {
                notVisibleCount++;
            }
        });

        const totalCount = visibleCount + notVisibleCount;
        const visiblePercentage = totalCount > 0 ? (visibleCount / totalCount) * 100 : 0;
        const notVisiblePercentage = 100 - visiblePercentage;

        return {
            visibleCount,
            notVisibleCount,
            visiblePercentage,
            notVisiblePercentage
        };
    },

    getSpeechText(): string {
        return this.audioEntries
            .filter(item => item && item.audioResult && typeof item.audioResult.text === 'string')
            .map(item => item.audioResult?.text || '')
            .join(' ');
    },

    getGazeDataForTimeline(): TimelinePoint[] {
        const result: TimelinePoint[] = [];

        for (let i = 0; i < this.frameData.length; i++) {
            const item = this.frameData[i];
            const timestamp = new Date(Number(item.timestamp) * 1000);
            const value = this.getGazeValue(item.gaze);

            result.push({ x: timestamp, y: value });

            if (i < this.frameData.length - 1) {
                const nextItem = this.frameData[i + 1];
                const nextValue = this.getGazeValue(nextItem.gaze);
                const nextTimestamp = new Date(Number(nextItem.timestamp) * 1000);

                if (value !== nextValue) {
                    result.push({ x: nextTimestamp, y: value });
                }
            }
        }

        return result;
    },

    getHeadPoseDataForTimeline(): TimelinePoint[] {
        const result: TimelinePoint[] = [];

        for (let i = 0; i < this.frameData.length; i++) {
            const item = this.frameData[i];
            const timestamp = new Date(Number(item.timestamp) * 1000);
            const value = this.getHeadPoseValue(item.head_pose_looking);

            result.push({ x: timestamp, y: value });

            if (i < this.frameData.length - 1) {
                const nextItem = this.frameData[i + 1];
                const nextValue = this.getHeadPoseValue(nextItem.head_pose_looking);
                const nextTimestamp = new Date(Number(nextItem.timestamp) * 1000);

                if (value !== nextValue) {
                    result.push({ x: nextTimestamp, y: value });
                }
            }
        }

        return result;
    },

    getGazeValue(gaze: unknown): number | null {
        if (typeof gaze !== 'string') {
            return null;
        }
        const gazeMap: Record<string, number | null> = {
            'Gaze center': 4,
            'Gaze right': 3,
            'Gaze left': 2,
            'Gaze up': 1,
            'Gaze down': 0,
            'N/A': null
        };
        return gazeMap[gaze] ?? null;
    },

    getGazeCenterPercentage(): number {
        const gazeEntries = this.frameData.filter(item => typeof item.gaze === 'string' && item.gaze !== 'N/A');
        if (gazeEntries.length === 0) {
            return 0;
        }
        const centerCount = gazeEntries.filter(item => item.gaze === 'Gaze center').length;
        return Math.round((centerCount / gazeEntries.length) * 100);
    },

    getHeadPoseValue(pose: unknown): number | null {
        if (typeof pose !== 'string') {
            return null;
        }
        const poseMap: Record<string, number | null> = {
            Forward: 4,
            'Looking Right': 3,
            'Looking Left': 2,
            'Looking Up': 1,
            'Looking Down': 0,
            'N/A': null
        };
        return poseMap[pose] ?? null;
    },

    getEmotionPercentages(): Record<string, number> {
        const emotions: Record<string, number> = this.emotionCounts;
        let total = 0;
        for (const emotion in emotions) {
            total += emotions[emotion] ?? 0;
        }
        if (total <= 0) {
            return {};
        }
        const percentages: Record<string, number> = {};
        for (const emotion in emotions) {
            const count = emotions[emotion] ?? 0;
            percentages[emotion] = (count / total) * 100;
        }
        return percentages;
    },

    getNoddingShakingData(): { nodCount: number; shakeCount: number; stillCount: number } {
        const frameData = this.frameData.filter(item => (
            item
            && Object.prototype.hasOwnProperty.call(item, 'head_pose_nodding')
            && Object.prototype.hasOwnProperty.call(item, 'head_pose_shaking')
        ));
        const noddingCount = frameData.filter(item => item.head_pose_nodding === 'Nodding').length;
        const shakingCount = frameData.filter(item => item.head_pose_shaking === 'Shaking').length;
        const stillCount = frameData.filter(item => (
            item.head_pose_nodding !== 'Nodding'
            && item.head_pose_shaking !== 'Shaking'
        )).length;
        return { nodCount: noddingCount, shakeCount: shakingCount, stillCount };
    },

    getGazeBreakdown(): DirectionStats {
        const directions = ['Gaze center', 'Gaze left', 'Gaze right', 'Gaze up', 'Gaze down'];
        const counts = directions.reduce<Record<string, number>>((acc, dir) => {
            acc[dir] = 0;
            return acc;
        }, {});

        let total = 0;
        this.frameData.forEach(item => {
            if (typeof item.gaze === 'string' && directions.includes(item.gaze)) {
                counts[item.gaze] += 1;
                total += 1;
            }
        });

        const percentages: Record<string, number> = {};
        directions.forEach(dir => {
            percentages[dir] = total > 0 ? parseFloat(((counts[dir] / total) * 100).toFixed(2)) : 0;
        });

        return {
            counts,
            percentages,
            total
        };
    },

    getHeadPoseBreakdown(): DirectionStats {
        const poses = ['Forward', 'Looking Left', 'Looking Right', 'Looking Up', 'Looking Down'];
        const counts = poses.reduce<Record<string, number>>((acc, pose) => {
            acc[pose] = 0;
            return acc;
        }, {});

        let total = 0;
        this.frameData.forEach(item => {
            if (typeof item.head_pose_looking === 'string' && poses.includes(item.head_pose_looking)) {
                counts[item.head_pose_looking] += 1;
                total += 1;
            }
        });

        const percentages: Record<string, number> = {};
        poses.forEach(pose => {
            percentages[pose] = total > 0 ? parseFloat(((counts[pose] / total) * 100).toFixed(2)) : 0;
        });

        return {
            counts,
            percentages,
            total
        };
    },

    getBrowData(): BrowSummary {
        const browData = this.frameData.filter(item => typeof item.brow === 'string' && item.brow !== 'N/A');
        const neutrals = browData.filter(item => item.brow === 'Brow neutral').length;
        const raised = browData.filter(item => item.brow === 'Brow Up').length;
        const lowered = browData.filter(item => item.brow === 'Brow Down').length;
        const activity = raised + lowered;
        const totalBrowData = browData.length;

        return {
            neutrals,
            raised,
            lowered,
            activity,
            totalBrowData,
            neutralPercentage: totalBrowData > 0 ? ((neutrals / totalBrowData) * 100).toFixed(2) : '0.00',
            raisedPercentage: totalBrowData > 0 ? ((raised / totalBrowData) * 100).toFixed(2) : '0.00',
            loweredPercentage: totalBrowData > 0 ? ((lowered / totalBrowData) * 100).toFixed(2) : '0.00',
            activityPercentage: totalBrowData > 0 ? ((activity / totalBrowData) * 100).toFixed(2) : '0.00'
        };
    },

    getCallDuration(): number | null {
        const audioData = this.audioEntries.find(item => item.duration !== undefined);
        if (!audioData) {
            return null;
        }
        const duration = parseFloat(String(audioData.duration));
        return Number.isFinite(duration) && duration >= 0 ? duration : null;
    },

    getLLMFeaturePayload(): AnalysisPayload {
        return {
            emotionCounts: this.emotionCounts,
            emotionPercentages: this.getEmotionPercentages(),
            uniqueEmotionCount: this.getUniqueEmotionCount(),
            gazeCenterPercentage: this.getGazeCenterPercentage(),
            gazeBreakdown: this.getGazeBreakdown(),
            headPoseBreakdown: this.getHeadPoseBreakdown(),
            noddingShaking: this.getNoddingShakingData(),
            shoulderVisibility: this.getShoulderVisibilityData(),
            browData: this.getBrowData(),
            speakingTimePercentage: this.getSpeakingTimePercentage(),
            callDuration: this.getCallDuration(),
            transcript: this.getSpeechText(),
            speechMarkers: this.getSpeechMarkers()
        };
    },

    getSpeechMarkers(): SpeechMarkerSummary | null {
        const text = this.getSpeechText();
        if (!text) {
            return null;
        }

        const sentences = text
            .split(/(?<=[\.\?\!])\s+|\n+/)
            .map(sentence => sentence.trim())
            .filter(Boolean);
        let openQuestionCount = 0;
        const questionExamples: string[] = [];

        sentences.forEach(sentence => {
            if (!startsWithOpenQuestionCue(sentence)) {
                return;
            }

            openQuestionCount++;
            if (questionExamples.length < 3) {
                questionExamples.push(sentence);
            }
        });

        const fillerCounts: Record<string, number> = {};
        let totalFillerWords = 0;
        FILLER_WORDS.forEach(word => {
            const count = countFillerOccurrences(text, word);
            if (count > 0) {
                fillerCounts[word] = count;
                totalFillerWords += count;
            }
        });

        const topFillers = Object.entries(fillerCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([word, count]) => ({ word, count }));

        return {
            openEndedQuestionCount: openQuestionCount,
            questionExamples,
            fillerWordCount: totalFillerWords,
            topFillers
        };
    }
};
