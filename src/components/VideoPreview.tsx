import { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

interface Props {
  uri: string;
  style?: StyleProp<ViewStyle>;
}

export default function VideoPreview({ uri, style }: Props) {
  const player = useVideoPlayer({ uri }, p => { p.loop = false; });

  return <VideoView player={player} style={style} nativeControls contentFit="contain" />;
}
