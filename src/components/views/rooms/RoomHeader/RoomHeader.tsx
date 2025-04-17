/*
Copyright 2024 New Vector Ltd.
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, {type JSX, useCallback, useEffect, useMemo, useState} from "react";
import {Body as BodyText, Button, IconButton, Menu, MenuItem, Tooltip} from "@vector-im/compound-web";
import VideoCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-solid";
import VoiceCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-solid";
import CloseCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/close";
import ThreadsIcon from "@vector-im/compound-design-tokens/assets/web/icons/threads-solid";
import RoomInfoIcon from "@vector-im/compound-design-tokens/assets/web/icons/info-solid";
import NotificationsIcon from "@vector-im/compound-design-tokens/assets/web/icons/notifications-solid";
import VerifiedIcon from "@vector-im/compound-design-tokens/assets/web/icons/verified";
import ErrorIcon from "@vector-im/compound-design-tokens/assets/web/icons/error-solid";
import PublicIcon from "@vector-im/compound-design-tokens/assets/web/icons/public";
import {type IOpenIDToken, JoinRule, type MatrixClient, type Room} from "matrix-js-sdk/src/matrix";
import {type ViewRoomOpts} from "@matrix-org/react-sdk-module-api/lib/lifecycles/RoomViewLifecycle";
import {Room as LivekitRoom, Track} from 'livekit-client';
import {
    RoomAudioRenderer,
    RoomContext,
    StartAudio,
    TrackToggle,
    useConnectionState
} from "@livekit/components-react";
import {logger} from "matrix-js-sdk/src/logger";

import {useRoomName} from "../../../../hooks/useRoomName.ts";
import {RightPanelPhases} from "../../../../stores/right-panel/RightPanelStorePhases.ts";
import {useMatrixClientContext} from "../../../../contexts/MatrixClientContext.tsx";
import {useRoomMemberCount, useRoomMembers} from "../../../../hooks/useRoomMembers.ts";
import {_t} from "../../../../languageHandler.tsx";
import {Flex} from "../../../utils/Flex.tsx";
import {Box} from "../../../utils/Box.tsx";
import {getPlatformCallTypeProps, useRoomCall} from "../../../../hooks/room/useRoomCall.tsx";
import {useRoomThreadNotifications} from "../../../../hooks/room/useRoomThreadNotifications.ts";
import {useGlobalNotificationState} from "../../../../hooks/useGlobalNotificationState.ts";
import SdkConfig from "../../../../SdkConfig.ts";
import {useFeatureEnabled} from "../../../../hooks/useSettings.ts";
import {useEncryptionStatus} from "../../../../hooks/useEncryptionStatus.ts";
import {E2EStatus} from "../../../../utils/ShieldUtils.ts";
import FacePile from "../../elements/FacePile.tsx";
import {useRoomState} from "../../../../hooks/useRoomState.ts";
import RoomAvatar from "../../avatars/RoomAvatar.tsx";
import {formatCount} from "../../../../utils/FormattingUtils.ts";
import RightPanelStore from "../../../../stores/right-panel/RightPanelStore.ts";
import PosthogTrackers from "../../../../PosthogTrackers.ts";
import {VideoRoomChatButton} from "./VideoRoomChatButton.tsx";
import {RoomKnocksBar} from "../RoomKnocksBar.tsx";
import {isVideoRoom as calcIsVideoRoom} from "../../../../utils/video-rooms.ts";
import {notificationLevelToIndicator} from "../../../../utils/notifications.ts";
import {CallGuestLinkButton} from "./CallGuestLinkButton.tsx";
import {type ButtonEvent} from "../../elements/AccessibleButton.tsx";
import WithPresenceIndicator, {useDmMember} from "../../avatars/WithPresenceIndicator.tsx";
import {type IOOBData} from "../../../../stores/ThreepidInviteStore.ts";
import {MainSplitContentType} from "../../../structures/RoomView.tsx";
import defaultDispatcher from "../../../../dispatcher/dispatcher.ts";
import {RoomSettingsTab} from "../../dialogs/RoomSettingsDialog.tsx";
import {useScopedRoomContext} from "../../../../contexts/ScopedRoomContext.tsx";
import {ToggleableIcon} from "./toggle/ToggleableIcon.tsx";
import {CurrentRightPanelPhaseContextProvider} from "../../../../contexts/CurrentRightPanelPhaseContext.tsx";
import {Icon as PttSpeakerIcon} from "../../../../../res/img/ptt/ic_speaker.svg";
import {Icon as PttSpeakerMutedIcon} from "../../../../../res/img/ptt/ic_speaker_muted.svg";

// The bits we need from MatrixClient
export type OpenIDClientParts = Pick<
    MatrixClient,
    "getOpenIdToken" | "getDeviceId"
>;

export interface PttConfig {
    url: string;
    jwt: string;
}

export async function fetchPttConfig(
    client: OpenIDClientParts,
    livekitUrl: string,
    roomId: string
): Promise<PttConfig> {
    const openIdToken = await client.getOpenIdToken();

    logger.info(`Trying to get JWT from livekit jwt service, url: ${livekitUrl}...`,);

    const sfuConfig = await getLiveKitJWT(
        client,
        livekitUrl,
        roomId,
        openIdToken,
    );

    logger.info(`Got JWT.`);

    return sfuConfig;
}

async function getLiveKitJWT(
    client: OpenIDClientParts,
    livekitServiceURL: string,
    roomId: string,
    openIDToken: IOpenIDToken,
): Promise<PttConfig> {

    const res = await fetch(livekitServiceURL + "/sfu/get", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            room: `ptt_${roomId}`,
            openid_token: openIDToken,
            device_id: client.getDeviceId(),
        }),
    });
    if (!res.ok) {
        throw new Error("SFU Config fetch failed with status code " + res.status);
    }
    return await res.json();
}

export default function RoomHeader(
    {
        room,
        additionalButtons,
        oobData,
    }: {
        room: Room;
        additionalButtons?: ViewRoomOpts["buttons"];
        oobData?: IOOBData;
    }): JSX.Element {
    const client = useMatrixClientContext();

    const roomName = useRoomName(room);
    const joinRule = useRoomState(room, (state) => state.getJoinRule());

    const members = useRoomMembers(room, 2500);
    const memberCount = useRoomMemberCount(room, {throttleWait: 2500});

    const {
        voiceCallDisabledReason,
        voiceCallClick,
        videoCallDisabledReason,
        videoCallClick,
        toggleCallMaximized: toggleCall,
        isViewingCall,
        isConnectedToCall,
        hasActiveCallSession,
        callOptions,
        showVoiceCallButton,
        showVideoCallButton,
    } = useRoomCall(room);

    const groupCallsEnabled = useFeatureEnabled("feature_group_calls");
    /**
     * A special mode where only Element Call is used. In this case we want to
     * hide the voice call button
     */
    const useElementCallExclusively = useMemo(() => {
        return SdkConfig.get("element_call").use_exclusively && groupCallsEnabled;
    }, [groupCallsEnabled]);

    const threadNotifications = useRoomThreadNotifications(room);
    const globalNotificationState = useGlobalNotificationState();

    const dmMember = useDmMember(room);
    const isDirectMessage = !!dmMember;
    const e2eStatus = useEncryptionStatus(client, room);

    const notificationsEnabled = useFeatureEnabled("feature_notifications");

    const askToJoinEnabled = useFeatureEnabled("feature_ask_to_join");

    const videoClick = useCallback(
        (ev: React.MouseEvent) => videoCallClick(ev, callOptions[0]),
        [callOptions, videoCallClick],
    );

    const [livekitRoom] = useState(() => new LivekitRoom({
        // Enable automatic audio/video quality optimization
        dynacast: true,
    }));

    const [errorFetchedChecker, setErrorFetchedChecker] = useState(false);
    const retryConnectingToLivekit = (): void => {
        setErrorFetchedChecker(c => !c);
        return
    }

    // Connect to room
    useEffect(() => {
        let mounted = true;

        const connect = async (): Promise<void> => {
            if (mounted) {
                try {
                    const sfuConfig = await fetchPttConfig(
                        room.client,
                        `${room.client.baseUrl}/livekit-jwt-service`,
                        room.roomId
                    )

                    await livekitRoom.connect(sfuConfig.url, sfuConfig.jwt);
                } catch (e) {
                    logger.warn(`failed to connect to ptt, error ${e}.`, e);
                    await new Promise(f => setTimeout(f, 3000));
                    retryConnectingToLivekit()
                }
            }
        };

        connect();

        return () => {
            mounted = false;
            livekitRoom.disconnect();
        };
    }, [room, livekitRoom, errorFetchedChecker]);

    const connectionState = useConnectionState(livekitRoom);

    const [pttSpeakerMuted, setPttSpeakerMuted] = useState(true);

    const pttToggleSpeakerMutedClick = async (): Promise<void> => {
        setPttSpeakerMuted((muted) => !muted)
        if (!pttSpeakerMuted) {
            await livekitRoom.startAudio()
        }
    }

    const toggleCallButton = (
        <Tooltip label={isViewingCall ? _t("voip|minimise_call") : _t("voip|maximise_call")}>
            <IconButton onClick={toggleCall}>
                <VideoCallIcon/>
            </IconButton>
        </Tooltip>
    );

    const joinCallButton = (
        <Tooltip label={videoCallDisabledReason ?? _t("voip|video_call")}>
            <Button
                size="sm"
                onClick={videoClick}
                Icon={VideoCallIcon}
                className="mx_RoomHeader_join_button"
                disabled={!!videoCallDisabledReason}
                color="primary"
                aria-label={videoCallDisabledReason ?? _t("action|join")}
            >
                {_t("action|join")}
            </Button>
        </Tooltip>
    );

    const callIconWithTooltip = (
        <Tooltip label={videoCallDisabledReason ?? _t("voip|video_call")}>
            <VideoCallIcon/>
        </Tooltip>
    );

    const [menuOpen, setMenuOpen] = useState(false);

    const onOpenChange = useCallback(
        (newOpen: boolean) => {
            if (!videoCallDisabledReason) setMenuOpen(newOpen);
        },
        [videoCallDisabledReason],
    );

    const startVideoCallButton = (
        <>
            {/* Can be either a menu or just a button depending on the number of call options.*/}
            {callOptions.length > 1 ? (
                <Menu
                    open={menuOpen}
                    onOpenChange={onOpenChange}
                    title={_t("voip|video_call_using")}
                    trigger={
                        <IconButton
                            disabled={!!videoCallDisabledReason}
                            aria-label={videoCallDisabledReason ?? _t("voip|video_call")}
                        >
                            {callIconWithTooltip}
                        </IconButton>
                    }
                    side="left"
                    align="start"
                >
                    {callOptions.map((option) => {
                        const {label, children} = getPlatformCallTypeProps(option);
                        return (
                            <MenuItem
                                key={option}
                                label={label}
                                aria-label={label}
                                children={children}
                                className="mx_RoomHeader_videoCallOption"
                                onClick={(ev) => videoCallClick(ev, option)}
                                Icon={VideoCallIcon}
                                onSelect={() => {
                                } /* Dummy handler since we want the click event.*/}
                            />
                        );
                    })}
                </Menu>
            ) : (
                <IconButton
                    disabled={!!videoCallDisabledReason}
                    aria-label={videoCallDisabledReason ?? _t("voip|video_call")}
                    onClick={videoClick}
                >
                    {callIconWithTooltip}
                </IconButton>
            )}
        </>
    );
    let voiceCallButton: JSX.Element | undefined = (
        <Tooltip label={voiceCallDisabledReason ?? _t("voip|voice_call")}>
            <IconButton
                // We need both: isViewingCall and isConnectedToCall
                //  - in the Lobby we are viewing a call but are not connected to it.
                //  - in pip view we are connected to the call but not viewing it.
                disabled={!!voiceCallDisabledReason || isViewingCall || isConnectedToCall}
                aria-label={voiceCallDisabledReason ?? _t("voip|voice_call")}
                onClick={(ev) => voiceCallClick(ev, callOptions[0])}
            >
                <VoiceCallIcon/>
            </IconButton>
        </Tooltip>
    );
    const closeLobbyButton = (
        <Tooltip label={_t("voip|close_lobby")}>
            <IconButton onClick={toggleCall}>
                <CloseCallIcon/>
            </IconButton>
        </Tooltip>
    );

    const pttToggleSpeakerMutedButton: JSX.Element | undefined = (
        <Tooltip label={pttSpeakerMuted ? _t("ptt|speaker_muted_button") : _t("ptt|speaker_unmuted_button")}>
            <IconButton
                disabled={false}
                aria-label={pttSpeakerMuted ? _t("ptt|speaker_muted_button") : _t("ptt|speaker_unmuted_button")}
                onClick={pttToggleSpeakerMutedClick}
            >

                {pttSpeakerMuted ? <PttSpeakerMutedIcon/> : <PttSpeakerIcon/>}
            </IconButton>
        </Tooltip>
    );

    const pttToggleMicMutedButton: JSX.Element | undefined = (
        <Tooltip label="PTT: Mic">
            <TrackToggle
                source={Track.Source.Microphone}
                initialState={false}
                className="bg-transparent p-0"
                // style={{background: "transparent"}}
            />
        </Tooltip>
    );

    let videoCallButton: JSX.Element | undefined = startVideoCallButton;
    if (isConnectedToCall) {
        videoCallButton = toggleCallButton;
    } else if (isViewingCall) {
        videoCallButton = closeLobbyButton;
    }

    if (!showVideoCallButton) {
        videoCallButton = undefined;
    }
    if (!showVoiceCallButton) {
        voiceCallButton = undefined;
    }

    const roomContext = useScopedRoomContext("mainSplitContentType");
    const isVideoRoom = calcIsVideoRoom(room);
    const showChatButton =
        isVideoRoom ||
        roomContext.mainSplitContentType === MainSplitContentType.MaximisedWidget ||
        roomContext.mainSplitContentType === MainSplitContentType.Call;

    const onAvatarClick = (): void => {
        defaultDispatcher.dispatch({
            action: "open_room_settings",
            initial_tab_id: RoomSettingsTab.General,
        });
    };

    return (
        <>
            <CurrentRightPanelPhaseContextProvider roomId={room.roomId}>
                <RoomContext.Provider value={livekitRoom}>
                    <RoomAudioRenderer muted={pttSpeakerMuted}/>
                    <StartAudio label="Click to start listening to PTT"/>
                    <Flex as="header" align="center" gap="var(--cpd-space-3x)" className="mx_RoomHeader light-panel">
                        <WithPresenceIndicator room={room} size="8px">
                            {/* We hide this from the tabIndex list as it is a pointer shortcut and superfluous for a11y */}
                            <RoomAvatar
                                room={room}
                                size="40px"
                                oobData={oobData}
                                onClick={onAvatarClick}
                                tabIndex={-1}
                                aria-label={_t("room|header_avatar_open_settings_label")}
                            />
                        </WithPresenceIndicator>
                        <button
                            aria-label={_t("right_panel|room_summary_card|title")}
                            tabIndex={0}
                            onClick={() => RightPanelStore.instance.showOrHidePhase(RightPanelPhases.RoomSummary)}
                            className="mx_RoomHeader_infoWrapper"
                        >
                            <Box flex="1" className="mx_RoomHeader_info">
                                <BodyText
                                    as="div"
                                    size="lg"
                                    weight="semibold"
                                    dir="auto"
                                    role="heading"
                                    aria-level={1}
                                    className="mx_RoomHeader_heading"
                                >
                                    <span className="mx_RoomHeader_truncated mx_lineClamp">{roomName}</span>

                                    {!isDirectMessage && joinRule === JoinRule.Public && (
                                        <Tooltip label={_t("common|public_room")} placement="right">
                                            <PublicIcon
                                                width="16px"
                                                height="16px"
                                                className="mx_RoomHeader_icon text-secondary"
                                                aria-label={_t("common|public_room")}
                                            />
                                        </Tooltip>
                                    )}

                                    {isDirectMessage && e2eStatus === E2EStatus.Verified && (
                                        <Tooltip label={_t("common|verified")} placement="right">
                                            <VerifiedIcon
                                                width="16px"
                                                height="16px"
                                                className="mx_RoomHeader_icon mx_Verified"
                                                aria-label={_t("common|verified")}
                                            />
                                        </Tooltip>
                                    )}

                                    {isDirectMessage && e2eStatus === E2EStatus.Warning && (
                                        <Tooltip label={_t("room|header_untrusted_label")} placement="right">
                                            <ErrorIcon
                                                width="16px"
                                                height="16px"
                                                className="mx_RoomHeader_icon mx_Untrusted"
                                                aria-label={_t("room|header_untrusted_label")}
                                            />
                                        </Tooltip>
                                    )}
                                </BodyText>
                            </Box>
                        </button>

                        {additionalButtons?.map((props) => {
                            const label = props.label();

                            return (
                                <Tooltip label={label} key={props.id}>
                                    <IconButton
                                        aria-label={label}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            props.onClick();
                                        }}
                                    >
                                        {typeof props.icon === "function" ? props.icon() : props.icon}
                                    </IconButton>
                                </Tooltip>
                            );
                        })}


                        <>
                            {!isDirectMessage && (<div>{_t("ptt|connection_status") + connectionState}</div>)}
                            {!isDirectMessage && pttToggleMicMutedButton}
                            {!isDirectMessage && pttToggleSpeakerMutedButton}
                        </>

                        {isViewingCall && <CallGuestLinkButton room={room}/>}

                        {hasActiveCallSession && !isConnectedToCall && !isViewingCall ? (
                            joinCallButton
                        ) : (
                            <>
                                {!isVideoRoom && videoCallButton}
                                {!useElementCallExclusively && !isVideoRoom && voiceCallButton}
                            </>
                        )}

                        {showChatButton && <VideoRoomChatButton room={room}/>}

                        <Tooltip label={_t("common|threads")}>
                            <IconButton
                                indicator={notificationLevelToIndicator(threadNotifications)}
                                onClick={(evt) => {
                                    evt.stopPropagation();
                                    RightPanelStore.instance.showOrHidePhase(RightPanelPhases.ThreadPanel);
                                    PosthogTrackers.trackInteraction("WebRoomHeaderButtonsThreadsButton", evt);
                                }}
                                aria-label={_t("common|threads")}
                            >
                                <ToggleableIcon Icon={ThreadsIcon} phase={RightPanelPhases.ThreadPanel}/>
                            </IconButton>
                        </Tooltip>
                        {notificationsEnabled && (
                            <Tooltip label={_t("notifications|enable_prompt_toast_title")}>
                                <IconButton
                                    indicator={notificationLevelToIndicator(globalNotificationState.level)}
                                    onClick={(evt) => {
                                        evt.stopPropagation();
                                        RightPanelStore.instance.showOrHidePhase(RightPanelPhases.NotificationPanel);
                                    }}
                                    aria-label={_t("notifications|enable_prompt_toast_title")}
                                >
                                    <ToggleableIcon Icon={NotificationsIcon}
                                                    phase={RightPanelPhases.NotificationPanel}/>
                                </IconButton>
                            </Tooltip>
                        )}

                        <Tooltip label={_t("right_panel|room_summary_card|title")}>
                            <IconButton
                                onClick={(evt) => {
                                    evt.stopPropagation();
                                    RightPanelStore.instance.showOrHidePhase(RightPanelPhases.RoomSummary);
                                }}
                                aria-label={_t("right_panel|room_summary_card|title")}
                            >
                                <ToggleableIcon Icon={RoomInfoIcon} phase={RightPanelPhases.RoomSummary}/>
                            </IconButton>
                        </Tooltip>

                        {!isDirectMessage && (
                            <BodyText as="div" size="sm" weight="medium">
                                <FacePile
                                    className="mx_RoomHeader_members"
                                    members={members.slice(0, 3)}
                                    size="20px"
                                    overflow={false}
                                    viewUserOnClick={false}
                                    tooltipLabel={_t("room|header_face_pile_tooltip")}
                                    onClick={(e: ButtonEvent) => {
                                        RightPanelStore.instance.showOrHidePhase(RightPanelPhases.MemberList);
                                        e.stopPropagation();
                                    }}
                                    aria-label={_t("common|n_members", {count: memberCount})}
                                >
                                    {formatCount(memberCount)}
                                </FacePile>
                            </BodyText>
                        )}
                    </Flex>
                    {askToJoinEnabled && <RoomKnocksBar room={room}/>}
                </RoomContext.Provider>
            </CurrentRightPanelPhaseContextProvider>
        </>
    );
}
