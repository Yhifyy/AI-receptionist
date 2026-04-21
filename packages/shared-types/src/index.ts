// ============================================
// CONVERSATION TYPES
// ============================================

export interface ConversationContext {
  tenantId: string;
  callId: string;
  businessName: string;
  industry: Industry;
  customer: CustomerContext | null;
  transcript: TranscriptEntry[];
  currentState: ConversationState;
  detectedIntents: IntentResult[];
  pendingActions: PendingAction[];
  config: TenantConfig;
}

export interface CustomerContext {
  id: string;
  name: string | null;
  phone: string;
  isVip: boolean;
  preferences: Record<string, any>;
  previousCalls: CallSummary[];
  lifetimeValue: number;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  confidence?: number;
  isFinal?: boolean;
}

export interface CallSummary {
  id: string;
  date: string;
  summary: string;
  outcome: string;
  sentiment: number;
}

// ============================================
// INTENT CLASSIFICATION
// ============================================

export type Industry = 'RESTAURANT' | 'SALON' | 'HOTEL' | 'RETAIL';

export enum ConversationState {
  GREETING = 'greeting',
  INTENT_DETECTION = 'intent_detection',
  BOOKING_FLOW = 'booking_flow',
  BOOKING_MODIFICATION = 'booking_modification',
  BOOKING_CANCELLATION = 'booking_cancellation',
  MENU_QA = 'menu_qa',
  GENERAL_INQUIRY = 'general_inquiry',
  UPSELL = 'upsell',
  CONFIRMATION = 'confirmation',
  HUMAN_HANDOFF = 'human_handoff',
  CLOSING = 'closing',
  ERROR = 'error',
}

export interface IntentResult {
  intent: string;
  confidence: number;
  entities: ExtractedEntity[];
  suggestedState: ConversationState;
  suggestedActions: string[];
}

export interface ExtractedEntity {
  type: string;
  value: string;
  confidence: number;
  normalized?: string;
}

// Restaurant-specific intents
export enum RestaurantIntent {
  MAKE_RESERVATION = 'make_reservation',
  MODIFY_RESERVATION = 'modify_reservation',
  CANCEL_RESERVATION = 'cancel_reservation',
  CHECK_AVAILABILITY = 'check_availability',
  MENU_INQUIRY = 'menu_inquiry',
  PRICE_INQUIRY = 'price_inquiry',
  ALLERGEN_INQUIRY = 'allergen_inquiry',
  HOURS_INQUIRY = 'hours_inquiry',
  LOCATION_INQUIRY = 'location_inquiry',
  SPECIAL_REQUEST = 'special_request',
  COMPLAINT = 'complaint',
  SPEAK_TO_HUMAN = 'speak_to_human',
  GENERAL_INQUIRY = 'general_inquiry',
  GOODBYE = 'goodbye',
}

// ============================================
// BOOKING TYPES
// ============================================

export interface BookingRequest {
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  guestPhone: string;
  guestEmail?: string;
  specialRequests?: string;
  occasion?: string;
}

export interface BookingSlot {
  time: string;
  available: boolean;
  tableOptions?: string[];
}

export interface BookingConfirmation {
  id: string;
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  confirmationCode: string;
  tableNumber?: string;
}

// ============================================
// VOICE PROCESSING
// ============================================

export interface VoiceConfig {
  voiceId: string;
  stability: number;
  similarityBoost: number;
  style?: number;
  speakingRate?: number;
}

export interface STTResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  words?: WordTiming[];
  duration?: number;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TTSRequest {
  text: string;
  voiceConfig: VoiceConfig;
  streamResponse?: boolean;
}

// ============================================
// CALL HANDLING
// ============================================

export interface IncomingCallEvent {
  callSid: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  accountSid: string;
  apiVersion: string;
}

export interface CallSession {
  id: string;
  tenantId: string;
  callSid: string;
  status: CallSessionStatus;
  context: ConversationContext;
  startedAt: number;
  lastActivityAt: number;
}

export type CallSessionStatus = 
  | 'initializing'
  | 'active'
  | 'on_hold'
  | 'transferring'
  | 'completed'
  | 'failed';

export interface CallMetrics {
  totalDuration: number;
  aiResponseTime: number[];
  sttLatency: number[];
  ttsLatency: number[];
  llmLatency: number[];
  turnCount: number;
  interruptionCount: number;
}

// ============================================
// ACTIONS & TOOLS
// ============================================

export interface PendingAction {
  type: ActionType;
  data: Record<string, any>;
  requiresConfirmation: boolean;
  confirmed: boolean;
}

export type ActionType =
  | 'create_booking'
  | 'modify_booking'
  | 'cancel_booking'
  | 'check_availability'
  | 'get_menu_info'
  | 'transfer_to_human'
  | 'send_confirmation'
  | 'add_to_waitlist'
  | 'schedule_callback';

export interface ActionResult {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  message?: string;
}

// ============================================
// ROUTING & ESCALATION
// ============================================

export interface RoutingDecision {
  route: RouteType;
  priority: number;
  reason: string;
  metadata?: Record<string, any>;
}

export type RouteType =
  | 'ai_standard'
  | 'ai_vip'
  | 'human_immediate'
  | 'human_callback'
  | 'voicemail';

export interface SentimentAnalysis {
  score: number; // -1 to 1
  label: 'negative' | 'neutral' | 'positive';
  confidence: number;
  triggers?: string[];
}

export interface EscalationTrigger {
  type: 'sentiment' | 'keyword' | 'intent' | 'duration' | 'loops';
  threshold: any;
  action: 'flag' | 'transfer' | 'callback';
}

// ============================================
// TENANT CONFIGURATION
// ============================================

export interface TenantConfig {
  businessName: string;
  industry: Industry;
  timezone: string;
  operatingHours: OperatingHours;
  voiceConfig: VoiceConfig;
  features: FeatureFlags;
  integrations: IntegrationConfig;
  
  // Industry-specific
  restaurantConfig?: RestaurantConfig;
  salonConfig?: SalonConfig;
  hotelConfig?: HotelConfig;
  retailConfig?: RetailConfig;
}

export interface OperatingHours {
  [day: string]: { open: string; close: string } | null;
}

export interface FeatureFlags {
  enableUpselling: boolean;
  enableMemory: boolean;
  enableABTesting: boolean;
  enableSentimentAnalysis: boolean;
  enableCallRecording: boolean;
  maxCallDuration: number;
}

export interface IntegrationConfig {
  googleCalendar?: { enabled: boolean; calendarId?: string };
  pos?: { type: string; enabled: boolean };
  crm?: { type: string; enabled: boolean };
  n8n?: { webhookUrl: string; enabled: boolean };
}

export interface RestaurantConfig {
  cuisineType: string;
  seatingCapacity: number;
  averageBookingDuration: number;
  maxPartySize: number;
  minAdvanceBooking: number;
  maxAdvanceBooking: number;
  autoConfirmBookings: boolean;
  tables?: TableConfig[];
}

export interface TableConfig {
  id: string;
  name: string;
  capacity: number;
  location?: string;
  features?: string[];
}

export interface SalonConfig {
  services: ServiceConfig[];
  staff: StaffConfig[];
  appointmentBuffer: number;
}

export interface ServiceConfig {
  id: string;
  name: string;
  duration: number;
  price: number;
  category: string;
}

export interface StaffConfig {
  id: string;
  name: string;
  services: string[];
  availability: OperatingHours;
}

export interface HotelConfig {
  roomTypes: RoomTypeConfig[];
  amenities: string[];
  checkInTime: string;
  checkOutTime: string;
}

export interface RoomTypeConfig {
  id: string;
  name: string;
  capacity: number;
  basePrice: number;
  amenities: string[];
}

export interface RetailConfig {
  storeType: string;
  returnPolicyDays: number;
  categories: string[];
}

// ============================================
// API TYPES
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ============================================
// WEBHOOK EVENTS
// ============================================

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  tenantId: string;
  timestamp: number;
  data: Record<string, any>;
}

export type WebhookEventType =
  | 'call.started'
  | 'call.completed'
  | 'call.failed'
  | 'booking.created'
  | 'booking.modified'
  | 'booking.cancelled'
  | 'customer.created'
  | 'customer.updated'
  | 'escalation.triggered';

// ============================================
// ANALYTICS
// ============================================

export interface AnalyticsSummary {
  period: { start: string; end: string };
  calls: {
    total: number;
    completed: number;
    transferred: number;
    averageDuration: number;
  };
  bookings: {
    total: number;
    converted: number;
    conversionRate: number;
  };
  revenue: {
    attributed: number;
    upsellRevenue: number;
  };
  satisfaction: {
    averageSentiment: number;
    positiveRate: number;
  };
}

export interface CallAnalytics {
  callId: string;
  metrics: CallMetrics;
  intents: IntentResult[];
  sentiment: SentimentAnalysis;
  outcome: string;
  transcript: TranscriptEntry[];
}
