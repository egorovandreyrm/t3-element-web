
// eslint-disable-next-line matrix-org/require-copyright-header
import React from "react";
import { type MatrixEvent, type MatrixClient, type TimelineEvents } from "matrix-js-sdk/src/matrix";
import { StreamEndEvent } from "matrix-js-sdk/src/extensible_events_v1/StreamEndEvent";

import { _t } from "../../../languageHandler";
import QuestionDialog from "./QuestionDialog";
import Modal from "../../../Modal";
import ErrorDialog from "./ErrorDialog";
import { type GetRelationsForEvent } from "../rooms/EventTile";

interface IProps {
    matrixClient: MatrixClient;
    event: MatrixEvent;
    onFinished: (success?: boolean) => void;
    getRelationsForEvent?: GetRelationsForEvent;
}

export default class EndStreamDialog extends React.Component<IProps> {
    private onFinished = async (endStream: boolean): Promise<void> => {
        if (endStream) {
            const room = this.props.matrixClient.getRoom(this.props.event.getRoomId());
            const stream = room?.streams.get(this.props.event.getId()!);

            if (!stream) {
                throw new Error("No stream instance found in room.");
            }

            try {
                const endEvent = StreamEndEvent.from(
                    this.props.event.getId()!,
                    _t("stream|end_message")
                ).serialize();

                await this.props.matrixClient.sendEvent(
                    this.props.event.getRoomId()!,
                    endEvent.type as keyof TimelineEvents,
                    endEvent.content as TimelineEvents[keyof TimelineEvents],
                );
            } catch (e) {
                console.error("Failed to submit end stream event:", e);
                Modal.createDialog(ErrorDialog, {
                    title: _t("stream|error_ending_title"),
                    description: _t("stream|error_ending_description"),
                });
            }
        }
        this.props.onFinished(endStream);
    };

    public render(): React.ReactNode {
        return (
            <QuestionDialog
                title={_t("stream|end_title")}
                description={_t("stream|end_description")}
                button={_t("stream|end_title")}
                onFinished={(endStream: boolean) => this.onFinished(endStream)}
        />
     );
    }
}
