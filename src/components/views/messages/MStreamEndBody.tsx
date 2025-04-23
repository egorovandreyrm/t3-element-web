import React, { useEffect, useState, useContext, type ForwardRefExoticComponent } from "react";
import { MatrixEvent, M_TEXT } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { Icon as StreamIcon } from "../../../../res/img/stream/ic_stream.svg";
import MatrixClientContext, { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { textForEvent } from "../../../TextForEvent";
import { Caption } from "../typography/Caption";
import { type IBodyProps } from "./IBodyProps";
import MStreamBody from "./MStreamBody.tsx";
import {_t} from "../../../languageHandler.tsx";

const getRelatedStreamStartEventId = (event: MatrixEvent): string | undefined => {
    const relation = event.getRelation();
    return relation?.event_id;
};

/**
 * Attempt to retrieve the related poll start event for this end event
 * If the event already exists in the rooms timeline, return it
 * Otherwise try to fetch the event from the server
 * @param event
 * @returns
 */
const useStreamStartEvent = (event: MatrixEvent): { streamStartEvent?: MatrixEvent; isLoadingStreamStartEvent: boolean } => {
    const matrixClient = useContext(MatrixClientContext);
    const [streamStartEvent, setStreamStartEvent] = useState<MatrixEvent>();
    const [isLoadingStreamStartEvent, setIsLoadingStreamStartEvent] = useState(false);

    const streamStartEventId = getRelatedStreamStartEventId(event);

    useEffect(() => {
        const room = matrixClient.getRoom(event.getRoomId());
        const fetchStreamStartEvent = async (roomId: string, streamStartEventId: string): Promise<void> => {
            setIsLoadingStreamStartEvent(true);
            try {
                const startEventJson = await matrixClient.fetchRoomEvent(roomId, streamStartEventId);
                const startEvent = new MatrixEvent(startEventJson);
                // add the poll to the room polls state
                room?.processStreamEvents([startEvent, event]);

                // end event is not a valid end to the related start event
                // if not sent by the same user
                if (startEvent.getSender() === event.getSender()) {
                    setStreamStartEvent(startEvent);
                }
            } catch (error) {
                logger.error("Failed to fetch related stream start event", error);
            } finally {
                setIsLoadingStreamStartEvent(false);
            }
        };

        if (streamStartEvent || !room || !streamStartEventId) {
            return;
        }

        const timelineSet = room.getUnfilteredTimelineSet();
        const localEvent = timelineSet
            ?.getTimelineForEvent(streamStartEventId)
            ?.getEvents()
            .find((e) => e.getId() === streamStartEventId);

        if (localEvent) {
            // end event is not a valid end to the related start event
            // if not sent by the same user
            if (localEvent.getSender() === event.getSender()) {
                setStreamStartEvent(localEvent);
            }
        } else {
            // pollStartEvent is not in the current timeline,
            // fetch it
            fetchStreamStartEvent(room.roomId, streamStartEventId);
        }
    }, [event, streamStartEventId, streamStartEvent, matrixClient]);

    return { streamStartEvent: streamStartEvent, isLoadingStreamStartEvent: isLoadingStreamStartEvent };
};

export const MStreamEndBody = React.forwardRef<any, IBodyProps>(({ mxEvent, ...props }, ref) => {
    const cli = useMatrixClientContext();
    const { streamStartEvent, isLoadingStreamStartEvent } = useStreamStartEvent(mxEvent);

    if (!streamStartEvent) {
        const streamEndFallbackMessage = M_TEXT.findIn<string>(mxEvent.getContent()) || textForEvent(mxEvent, cli);
        return (
            <>
                <StreamIcon className="mx_MPollEndBody_icon" />
                {!isLoadingStreamStartEvent && streamEndFallbackMessage}
        </>
    );
    }

    return (
        <div className="mx_MPollEndBody" ref={ref}>
        <Caption>{_t("timeline|m.stream.end|ended")}</Caption>

            <MStreamBody mxEvent={streamStartEvent} {...props} />
    </div>
);
}) as ForwardRefExoticComponent<IBodyProps>;
