interface UADataValues {
  platform: string;
  platformVersion: string;
}

interface NavigatorUAData {
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<UADataValues>;
}

interface Navigator {
  userAgentData?: NavigatorUAData;
}
